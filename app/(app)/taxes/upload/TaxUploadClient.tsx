"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDollars } from "@/lib/format";
import { takeHandoffFile } from "@/lib/fileHandoff";
import { defaultDates, type CountyDefault } from "@/lib/tax";
import { IDENTIFIER_KIND_LABELS, printedIdentifier, type IdentifierKind, type PrintedIdentifier, type StoredIdentifier } from "@/lib/taxIdentifiers";
import { groupPages, reconcile, type PageHeader, type RegisteredAccount, type StatementGroup } from "@/lib/taxSegment";
import { careOfTarget, matchEntity, matchLine, type MatchableEntityRef } from "@/lib/taxMatch";
import { extractFile, extractStored } from "@/components/documents/classify";
import { confirmLineParcel, confirmStatementEntity } from "@/components/taxes/taxLearn";

// ---------------------------------------------------------------- types

interface ParcelRef {
  id: string;
  parcel_number: string;
  county: string | null;
  property_id: string;
  property_name: string | null;
}

interface LineDraft {
  localId: string;
  lineType: "real_property" | "personal_property";
  identifiers: PrintedIdentifier[];
  appraised: string;
  assessed: string;
  tax: string;
  exemptions: string;
  legal: string;
  address: string;
  acres: string;
  // Match state
  mode: "matched" | "unmatched" | "create";
  parcelId: string;
  matchSource: "identifier" | "manual" | null;
  evidence: string | null;
  candidates: Array<{ parcelId: string; evidence: string }>;
  newParcelNumber: string;
  newParcelCounty: string;
  newParcelPropertyId: string;
  legalOpen: boolean;
}

interface StatementDraft {
  localId: string;
  fileLocalId: string;
  pages: number[];
  status: "review" | "saving" | "saved" | "skipped" | "error";
  error: string | null;
  unsure: string[];
  open: boolean;
  county: string;
  state: string;
  authority: string;
  account: string;
  accountKind: string;
  taxpayer: string;
  careOf: string;
  taxYear: number;
  total: string;
  dueDate: string;
  delinquentDate: string;
  notes: string;
  entityId: string;
  entityEvidence: string | null;
  comparedName: string | null;
  lines: LineDraft[];
  rememberDates: boolean;
}

interface FileJob {
  localId: string;
  file: File;
  storagePath: string | null;
  status: "segmenting" | "reading" | "done" | "error";
  progress: string;
  error: string | null;
}

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const smallInput = "w-full rounded border border-gray-300 px-2 py-1 text-xs";

const num = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : String(v));
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const money = (s: string): number | null => {
  const n = Number(String(s).replace(/[,$]/g, ""));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

// ---------------------------------------------------------------- component

export default function TaxUploadClient({
  orgId,
  parcels,
  properties,
  entities,
  accounts,
  storedIdentifiers,
  countyDefaults,
}: {
  orgId: string;
  parcels: ParcelRef[];
  properties: Array<{ id: string; name: string; entity_id: string | null }>;
  entities: MatchableEntityRef[];
  accounts: RegisteredAccount[];
  storedIdentifiers: StoredIdentifier[];
  countyDefaults: CountyDefault[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileJob[]>([]);
  const [statements, setStatements] = useState<StatementDraft[]>([]);
  // The identifier store grows as confirmations learn; kept in state so
  // a later statement in the same session matches on what the first taught.
  const [stored, setStored] = useState<StoredIdentifier[]>(storedIdentifiers);
  const [parcelList, setParcelList] = useState<ParcelRef[]>(parcels);
  const [confirmingAll, setConfirmingAll] = useState(false);

  const parcelById = useMemo(() => new Map(parcelList.map((p) => [p.id, p])), [parcelList]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  function patchFile(id: string, patch: Partial<FileJob>) {
    setFiles((list) => list.map((f) => (f.localId === id ? { ...f, ...patch } : f)));
  }
  function patchStatement(id: string, patch: Partial<StatementDraft>) {
    setStatements((list) => list.map((s) => (s.localId === id ? { ...s, ...patch } : s)));
  }
  function patchLine(sid: string, lid: string, patch: Partial<LineDraft>) {
    setStatements((list) =>
      list.map((s) =>
        s.localId === sid ? { ...s, lines: s.lines.map((l) => (l.localId === lid ? { ...l, ...patch } : l)) } : s
      )
    );
  }

  // ---- handoff from the document intake
  const searchParams = useSearchParams();
  const handoffKey = searchParams.get("handoff");
  useEffect(() => {
    if (!handoffKey) return;
    takeHandoffFile(handoffKey).then((f) => {
      if (!f) return;
      const dt = new DataTransfer();
      dt.items.add(f);
      handleFiles(dt.files);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffKey]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    for (const file of Array.from(fileList)) {
      const job: FileJob = {
        localId: crypto.randomUUID(),
        file,
        storagePath: null,
        status: "segmenting",
        progress: "Uploading and finding statements...",
        error: null,
      };
      setFiles((list) => [...list, job]);
      processFile(job);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ---- stage 1 + 2: segment, then read each statement
  async function processFile(job: FileJob) {
    const seg = await extractFile(supabase, { orgId, file: job.file, kind: "tax_segment" });
    if ("error" in seg) {
      patchFile(job.localId, { status: "error", error: seg.error, progress: "" });
      return;
    }
    const storagePath = seg.storagePath;
    patchFile(job.localId, { storagePath });
    const isPdf = job.file.type === "application/pdf" || job.file.name.toLowerCase().endsWith(".pdf");
    const rawPages = Array.isArray(seg.extraction.pages) ? (seg.extraction.pages as Array<Record<string, unknown>>) : [];
    const headers: PageHeader[] = rawPages.map((p, i) => ({
      page: Number(p.page_number) || i + 1,
      county: (p.county as string | null) ?? null,
      state: (p.state as string | null) ?? null,
      billing_key: (p.billing_key as string | null) ?? null,
      billing_kind: (p.billing_kind as string | null) ?? null,
      taxpayer_name: (p.taxpayer_name as string | null) ?? null,
      tax_year: p.tax_year === null || p.tax_year === undefined ? null : Number(p.tax_year),
      total_tax: p.total_tax === null || p.total_tax === undefined ? null : Number(p.total_tax),
      is_continuation: Boolean(p.is_continuation),
      is_statement: p.is_statement === undefined ? true : Boolean(p.is_statement),
    }));
    let groups: StatementGroup[] = groupPages(headers, accounts);
    if (groups.length === 0) {
      // Nothing recognized as a statement: read the whole file as one so
      // the user can still review it.
      groups = [
        {
          key: "whole",
          pages: headers.map((h) => h.page),
          county: null,
          state: null,
          billing_key: null,
          billing_kind: null,
          taxpayer_name: null,
          tax_year: null,
          total_tax: null,
          entity_id: null,
          entity_evidence: null,
        },
      ];
    }
    patchFile(job.localId, { status: "reading", progress: `Found ${groups.length} statement${groups.length === 1 ? "" : "s"}. Reading 1 of ${groups.length}...` });

    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < groups.length) {
        const g = groups[next++];
        const res = await extractStored({
          storagePath,
          fileName: job.file.name,
          contentType: job.file.type || "application/pdf",
          kind: "tax_statement",
          extra: isPdf && g.pages.length > 0 ? { pages: g.pages.join(",") } : {},
        });
        done++;
        patchFile(job.localId, { progress: `Reading statement ${Math.min(done + 1, groups.length)} of ${groups.length}...` });
        if ("error" in res) {
          setStatements((list) => [...list, errorDraft(job.localId, g, res.error)]);
          continue;
        }
        setStatements((list) => [...list, buildDraft(job.localId, g, res.extraction)]);
      }
    };
    await Promise.all([worker(), worker()]);
    patchFile(job.localId, { status: "done", progress: "" });
  }

  function errorDraft(fileLocalId: string, g: StatementGroup, error: string): StatementDraft {
    const year = g.tax_year ?? new Date().getFullYear();
    const dates = defaultDates(year, g.county, g.state, countyDefaults);
    return {
      localId: crypto.randomUUID(),
      fileLocalId,
      pages: g.pages,
      status: "review",
      error: error + " Fill in the fields by hand.",
      unsure: [],
      open: true,
      county: g.county ?? "",
      state: g.state ?? "",
      authority: "",
      account: g.billing_key ?? "",
      accountKind: g.billing_kind ?? "other",
      taxpayer: g.taxpayer_name ?? "",
      careOf: "",
      taxYear: year,
      total: num(g.total_tax),
      dueDate: dates.due_date,
      delinquentDate: dates.delinquent_date,
      notes: "",
      entityId: g.entity_id ?? "",
      entityEvidence: g.entity_evidence,
      comparedName: g.taxpayer_name,
      lines: [],
      rememberDates: false,
    };
  }

  // ---- stage 3: the review model (matching runs here, deterministically)
  function buildDraft(fileLocalId: string, g: StatementGroup, x: Record<string, unknown>): StatementDraft {
    const county = str(x.county) || (g.county ?? "");
    const state = (str(x.state) || (g.state ?? "")).toUpperCase();
    const year = Number(x.tax_year) || g.tax_year || new Date().getFullYear();
    const dates = defaultDates(year, county, state, countyDefaults);
    const rawLines = Array.isArray(x.lines) ? (x.lines as Array<Record<string, unknown>>) : [];
    const lines: LineDraft[] = rawLines.map((l) => {
      const rawIds = Array.isArray(l.identifiers) ? (l.identifiers as Array<Record<string, unknown>>) : [];
      const identifiers = rawIds
        .map((i) => printedIdentifier(str(i.label), i.kind, str(i.value)))
        .filter((i): i is PrintedIdentifier => i !== null);
      const lineType: LineDraft["lineType"] = l.line_type === "personal_property" ? "personal_property" : "real_property";
      const m = matchLine({ line_type: lineType, identifiers }, stored, parcelList);
      const firstParcelId = identifiers.find((i) => i.kind === "parcel_number")?.value ?? identifiers[0]?.value ?? "";
      return {
        localId: crypto.randomUUID(),
        lineType,
        identifiers,
        appraised: num(l.appraised_value),
        assessed: num(l.assessed_value),
        tax: num(l.tax_due),
        exemptions: str(l.exemptions),
        legal: str(l.legal_description),
        address: str(l.property_address),
        acres: num(l.acres),
        mode: m.parcelId ? "matched" : "unmatched",
        parcelId: m.parcelId ?? "",
        matchSource: m.parcelId ? "identifier" : null,
        evidence: m.evidence,
        candidates: m.candidates,
        newParcelNumber: firstParcelId,
        newParcelCounty: county,
        newParcelPropertyId: properties[0]?.id ?? "",
        legalOpen: false,
      };
    });
    const taxpayer = str(x.taxpayer_name) || (g.taxpayer_name ?? "");
    const careOf = str(x.care_of);
    // Entity: the registry pre-label wins; else the name matcher.
    let entityId = g.entity_id ?? "";
    let entityEvidence = g.entity_evidence;
    let comparedName: string | null = careOfTarget(taxpayer, careOf) ?? (taxpayer || null);
    if (!entityId) {
      const em = matchEntity({ taxpayer_name: taxpayer, care_of: careOf || null }, entities);
      entityId = em.entityId ?? "";
      entityEvidence = em.evidence;
      comparedName = em.comparedName ?? comparedName;
    }
    const lineSum = lines.reduce((a, l) => a + (money(l.tax) ?? 0), 0);
    const totalRaw = x.total_tax === null || x.total_tax === undefined ? g.total_tax : Number(x.total_tax);
    return {
      localId: crypto.randomUUID(),
      fileLocalId,
      pages: g.pages,
      status: "review",
      error: null,
      unsure: Array.isArray(x.unsure_fields) ? (x.unsure_fields as unknown[]).map(String) : [],
      open: false,
      county,
      state,
      authority: str(x.authority_name),
      account: str(x.billing_key) || (g.billing_key ?? ""),
      accountKind: str(x.billing_kind) || g.billing_kind || "other",
      taxpayer,
      careOf,
      taxYear: year,
      total: totalRaw === null || totalRaw === undefined ? (lines.length ? String(Math.round(lineSum * 100) / 100) : "") : String(totalRaw),
      dueDate: str(x.due_date) || dates.due_date,
      delinquentDate: str(x.delinquent_date) || dates.delinquent_date,
      notes: "",
      entityId,
      entityEvidence,
      comparedName,
      lines,
      rememberDates: false,
    };
  }

  // ---- derived per statement
  function recon(s: StatementDraft) {
    return reconcile(
      s.lines.map((l) => money(l.tax)),
      money(s.total)
    );
  }
  function needsAttention(s: StatementDraft): string[] {
    const issues: string[] = [];
    if (!s.county.trim()) issues.push("county");
    if (!s.taxYear) issues.push("tax year");
    if (money(s.total) === null && s.lines.length === 0) issues.push("total");
    if (!recon(s).reconciled) issues.push("lines do not reconcile");
    if (s.lines.some((l) => l.lineType === "real_property" && l.mode === "unmatched" && l.candidates.length > 1)) issues.push("pick a parcel");
    if (s.lines.some((l) => l.mode === "create" && (!l.newParcelNumber.trim() || !l.newParcelPropertyId))) issues.push("new parcel details");
    return issues;
  }

  // ---- confirm = save
  async function confirmStatement(s: StatementDraft): Promise<void> {
    patchStatement(s.localId, { status: "saving", error: null });
    const county = s.county.trim() || null;
    const state = s.state.trim().toUpperCase() || null;
    const account = s.account.trim() || null;
    const r = recon(s);
    const lineSum = r.lineTotal;
    const total = money(s.total) ?? lineSum;

    // Duplicate guard: same county, state, account, year already on file.
    if (account && county) {
      let q = supabase
        .from("tax_statements")
        .select("id")
        .eq("organization_id", orgId)
        .eq("county", county)
        .eq("account_number", account)
        .eq("tax_year", s.taxYear);
      q = state ? q.eq("state", state) : q.is("state", null);
      const { data: dup } = await q.limit(1);
      if ((dup ?? []).length > 0) {
        patchStatement(s.localId, {
          status: "skipped",
          error: `A ${s.taxYear} statement for ${county} County account ${account} is already on file. Open the Property Taxes page to see it; delete it first if this upload should replace it.`,
        });
        return;
      }
    }

    // New parcels first (create mode), so the lines can point at them.
    const createdParcels = new Map<string, string>();
    for (const l of s.lines) {
      if (l.mode !== "create") continue;
      if (!l.newParcelNumber.trim() || !l.newParcelPropertyId) {
        patchStatement(s.localId, { status: "review", error: "Give each new parcel a number and a property." });
        return;
      }
      const { data, error } = await supabase
        .from("parcels")
        .insert({
          organization_id: orgId,
          property_id: l.newParcelPropertyId,
          parcel_number: l.newParcelNumber.trim(),
          county: l.newParcelCounty.trim() || null,
        })
        .select("id")
        .single();
      if (error || !data) {
        patchStatement(s.localId, { status: "review", error: "Could not create the parcel: " + (error?.message ?? "") });
        return;
      }
      createdParcels.set(l.localId, data.id as string);
      const prop = properties.find((p) => p.id === l.newParcelPropertyId);
      setParcelList((list) => [
        ...list,
        { id: data.id as string, parcel_number: l.newParcelNumber.trim(), county: l.newParcelCounty.trim() || null, property_id: l.newParcelPropertyId, property_name: prop?.name ?? null },
      ]);
    }

    const entity = s.entityId ? (entityById.get(s.entityId) ?? null) : null;
    const { data: statement, error: stErr } = await supabase
      .from("tax_statements")
      .insert({
        organization_id: orgId,
        tax_year: s.taxYear,
        county,
        state,
        authority_name: s.authority.trim() || null,
        account_number: account,
        account_kind: account ? (s.accountKind || "other") : null,
        taxpayer_name_printed: s.taxpayer.trim() || null,
        care_of_printed: s.careOf.trim() || null,
        amount_due: total,
        line_total: lineSum,
        reconciled: r.reconciled,
        due_date: s.dueDate || null,
        delinquent_date: s.delinquentDate || null,
        notes: s.notes.trim() || null,
        entity_id: entity?.id ?? null,
        entity_evidence: entity ? s.entityEvidence : null,
      })
      .select("id")
      .single();
    if (stErr || !statement) {
      patchStatement(s.localId, {
        status: "review",
        error:
          stErr?.code === "23505" || /duplicate/i.test(stErr?.message ?? "")
            ? `A ${s.taxYear} statement for this account is already on file.`
            : "Could not save: " + (stErr?.message ?? ""),
      });
      return;
    }
    const statementId = statement.id as string;
    const rollback = async () => {
      await supabase.from("tax_statements").delete().eq("id", statementId);
    };

    // The source file, attached as the statement's document.
    const job = files.find((f) => f.localId === s.fileLocalId);
    if (job?.storagePath) {
      const title = `${county ?? "County"} County property tax ${s.taxYear}${account ? ` (${account})` : ""}`;
      const { data: doc } = await supabase
        .from("documents")
        .insert({
          organization_id: orgId,
          entity_type: "tax_statement",
          entity_id: statementId,
          file_name: job.file.name,
          storage_path: job.storagePath,
          content_type: job.file.type || null,
          size_bytes: job.file.size,
          doc_type: "other",
          title,
          title_reviewed: true,
        })
        .select("id")
        .single();
      if (doc?.id) await supabase.from("tax_statements").update({ source_document_id: doc.id }).eq("id", statementId);
    }

    // Lines.
    const lineRows = s.lines.map((l, i) => {
      const parcelId = l.mode === "create" ? (createdParcels.get(l.localId) ?? null) : l.mode === "matched" && l.parcelId ? l.parcelId : null;
      const isPP = l.lineType === "personal_property";
      const matchSource = isPP || !parcelId ? null : l.mode === "create" ? "manual" : (l.matchSource ?? "manual");
      return {
        organization_id: orgId,
        tax_statement_id: statementId,
        line_no: i + 1,
        tax_year: s.taxYear,
        line_type: l.lineType,
        identifiers: l.identifiers,
        appraised_value: money(l.appraised),
        assessed_value: money(l.assessed),
        tax_due: money(l.tax) ?? 0,
        exemptions: l.exemptions.trim() || null,
        legal_description: l.legal.trim() || null,
        property_address: l.address.trim() || null,
        acres: money(l.acres),
        parcel_id: isPP ? null : parcelId,
        match_source: matchSource,
        match_evidence: isPP || !parcelId ? null : l.mode === "create" ? "Parcel created from this statement" : l.evidence,
        confirmed: true,
      };
    });
    if (lineRows.length > 0) {
      const { data: inserted, error: lnErr } = await supabase.from("tax_statement_lines").insert(lineRows).select("id, line_no, parcel_id");
      if (lnErr || !inserted) {
        await rollback();
        let msg = "Could not save the lines: " + (lnErr?.message ?? "");
        if (lnErr?.code === "23505" || /duplicate/i.test(lnErr?.message ?? "")) {
          const dupLine = s.lines.find((l) => l.parcelId && l.mode === "matched");
          const pn = dupLine ? (parcelById.get(dupLine.parcelId)?.parcel_number ?? "") : "";
          msg = `Parcel ${pn} already has a ${s.taxYear} line on another statement. Open the Property Taxes page to see it.`;
        }
        patchStatement(s.localId, { status: "review", error: msg });
        return;
      }
      // Learning: every identifier printed on a matched line saves onto its parcel.
      let learnedStore = stored;
      for (const row of inserted) {
        const l = s.lines[(row.line_no as number) - 1];
        const parcelId = row.parcel_id as string | null;
        if (!l || !parcelId) continue;
        const err = await confirmLineParcel(supabase, {
          orgId,
          lineId: row.id as string,
          parcelId,
          identifiers: l.identifiers,
          source: l.mode === "create" ? "manual" : (l.matchSource ?? "manual"),
          evidence: l.mode === "create" ? "Parcel created from this statement" : l.evidence,
          stored: learnedStore,
        });
        if (err) {
          patchStatement(s.localId, { error: "Saved, but could not remember the identifiers: " + err });
        }
        learnedStore = [
          ...learnedStore,
          ...l.identifiers.map((i) => ({ parcel_id: parcelId, kind: i.kind, value: i.value, normalized: i.normalized })),
        ];
      }
      setStored(learnedStore);
    }

    // Entity learning: account registry and the printed spelling.
    if (entity) {
      const err = await confirmStatementEntity(supabase, {
        orgId,
        statementId,
        entity,
        evidence: s.entityEvidence,
        county,
        state,
        accountNumber: account,
        comparedName: s.comparedName,
      });
      if (err) patchStatement(s.localId, { error: "Saved, but could not register the account: " + err });
    }

    // County dates, when asked.
    if (s.rememberDates && county && s.dueDate && s.delinquentDate) {
      const due = s.dueDate.split("-").map(Number);
      const del = s.delinquentDate.split("-").map(Number);
      await supabase.from("county_tax_defaults").upsert(
        {
          organization_id: orgId,
          county,
          state: state ?? "",
          due_month: due[1],
          due_day: due[2],
          delinquent_month: del[1],
          delinquent_day: del[2],
        },
        { onConflict: "organization_id,county,state" }
      );
    }
    patchStatement(s.localId, { status: "saved", open: false });
  }

  async function confirmAllReconciled() {
    setConfirmingAll(true);
    for (const s of statements) {
      if (s.status !== "review") continue;
      if (needsAttention(s).length > 0) continue;
      // eslint-disable-next-line no-await-in-loop
      await confirmStatement(s);
    }
    setConfirmingAll(false);
  }

  // Re-run the line match when the user edits identifiers or the parcel list grows.
  function rematch(sid: string, l: LineDraft) {
    const m = matchLine({ line_type: l.lineType, identifiers: l.identifiers }, stored, parcelList);
    patchLine(sid, l.localId, {
      mode: m.parcelId ? "matched" : "unmatched",
      parcelId: m.parcelId ?? "",
      matchSource: m.parcelId ? "identifier" : null,
      evidence: m.evidence,
      candidates: m.candidates,
    });
  }

  const isUnsure = (s: StatementDraft, key: string) => s.unsure.includes(key);
  const ring = (s: StatementDraft, key: string) => (isUnsure(s, key) ? " border-amber-400 ring-2 ring-amber-100" : "");
  const reviewable = statements.filter((s) => s.status === "review");
  const readyCount = reviewable.filter((s) => needsAttention(s).length === 0).length;
  const savedCount = statements.filter((s) => s.status === "saved").length;
  const busy = files.some((f) => f.status === "segmenting" || f.status === "reading");

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <Link href="/taxes" className="text-sm text-gray-500 hover:underline">
          Property Taxes
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Upload tax statements</h1>
        <p className="text-sm text-gray-600">
          Drop the county&apos;s PDFs or photos. One file can hold many statements and one statement can run many pages; the reader
          finds each statement, reads every parcel line on it, and matches the numbers it prints to your parcels. Nothing is saved
          until you confirm.
        </p>
      </div>

      <div
        className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-6 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
      >
        <p className="text-sm text-gray-700">Drop PDFs or photos here, or</p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
        >
          Choose files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="mt-2 text-xs text-gray-500">Handwritten notes on the pages are ignored; only printed text is read.</p>
      </div>

      {files.length > 0 ? (
        <ul className="space-y-1 text-xs text-gray-600">
          {files.map((f) => (
            <li key={f.localId} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5">
              <span className="font-medium text-gray-800">{f.file.name}</span>
              {f.status === "segmenting" || f.status === "reading" ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-kelly-500" />
                  {f.progress}
                </span>
              ) : f.status === "error" ? (
                <span className="text-red-600">{f.error}</span>
              ) : (
                <span>{statements.filter((s) => s.fileLocalId === f.localId).length} statement(s) read</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {statements.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-sm text-gray-700">
            {statements.length} statement{statements.length === 1 ? "" : "s"}: {readyCount} ready, {reviewable.length - readyCount} need
            attention, {savedCount} saved.
          </p>
          <button
            type="button"
            onClick={confirmAllReconciled}
            disabled={confirmingAll || busy || readyCount === 0}
            className="ml-auto rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
          >
            {confirmingAll ? "Saving..." : `Confirm all ready (${readyCount})`}
          </button>
        </div>
      ) : null}

      <ul className="space-y-3">
        {statements.map((s) => {
          const r = recon(s);
          const issues = needsAttention(s);
          const entity = s.entityId ? entityById.get(s.entityId) : null;
          const border =
            s.status === "saved" ? "border-kelly-200" : s.status === "skipped" ? "border-gray-200" : issues.length ? "border-amber-300" : "border-gray-200";
          return (
            <li key={s.localId} className={`rounded-xl border bg-white ${border}`}>
              <button
                type="button"
                onClick={() => patchStatement(s.localId, { open: !s.open })}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold text-gray-900">
                  {s.county || "Unknown"} County {s.taxYear}
                  {s.account ? <span className="font-normal text-gray-500"> · {IDENTIFIER_KIND_LABELS[(s.accountKind as IdentifierKind) ?? "other"] ?? "Number"} {s.account}</span> : null}
                </span>
                <span className="text-xs text-gray-600">{s.taxpayer || "No taxpayer read"}</span>
                {entity ? (
                  <span className="rounded-full bg-kelly-50 px-2 py-0.5 text-xs font-medium text-pine-900">{entity.name}</span>
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">No entity</span>
                )}
                <span className="ml-auto text-sm font-medium tabular-nums text-gray-900">{money(s.total) !== null ? formatDollars(money(s.total)!) : "no total"}</span>
                <span className="text-xs text-gray-500">
                  {s.lines.length} line{s.lines.length === 1 ? "" : "s"} · pages {s.pages.length ? `${s.pages[0]}${s.pages.length > 1 ? `-${s.pages[s.pages.length - 1]}` : ""}` : "?"}
                </span>
                {s.status === "saved" ? (
                  <span className="rounded-full bg-kelly-50 px-2 py-0.5 text-xs font-medium text-pine-900">Saved</span>
                ) : s.status === "skipped" ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Skipped</span>
                ) : r.reconciled ? (
                  <span className="rounded-full bg-kelly-50 px-2 py-0.5 text-xs font-medium text-pine-900">Reconciles</span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                    {r.gap === null ? "No total to check" : `Lines sum to ${formatDollars(r.lineTotal)}, statement says ${formatDollars(money(s.total)!)} (gap ${formatDollars(r.gap)})`}
                  </span>
                )}
                {s.status === "review" && issues.length ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">Needs: {issues.join(", ")}</span>
                ) : s.status === "review" ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">Ready</span>
                ) : null}
              </button>
              {s.error ? <p className="px-4 pb-2 text-xs text-red-600">{s.error}</p> : null}

              {s.open && s.status !== "saved" && s.status !== "skipped" ? (
                <div className="space-y-4 border-t border-gray-100 px-4 py-4">
                  {/* Header */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="County">
                      <input value={s.county} onChange={(e) => patchStatement(s.localId, { county: e.target.value })} className={inputClass + ring(s, "county")} />
                    </Field>
                    <Field label="State">
                      <input value={s.state} onChange={(e) => patchStatement(s.localId, { state: e.target.value.toUpperCase() })} className={inputClass + ring(s, "state")} />
                    </Field>
                    <Field label="Tax year">
                      <input type="number" value={s.taxYear} onChange={(e) => patchStatement(s.localId, { taxYear: Number(e.target.value) })} className={inputClass + ring(s, "tax_year")} />
                    </Field>
                    <Field label="Taxing authority">
                      <input value={s.authority} onChange={(e) => patchStatement(s.localId, { authority: e.target.value })} className={inputClass + ring(s, "authority_name")} />
                    </Field>
                    <Field label="Billing number (as printed)">
                      <div className="flex gap-1">
                        <select value={s.accountKind} onChange={(e) => patchStatement(s.localId, { accountKind: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-2 text-xs">
                          {(["account_number", "receipt_number", "key_number", "bill_number", "parcel_number", "other"] as const).map((k) => (
                            <option key={k} value={k}>{IDENTIFIER_KIND_LABELS[k]}</option>
                          ))}
                        </select>
                        <input value={s.account} onChange={(e) => patchStatement(s.localId, { account: e.target.value })} className={inputClass + ring(s, "billing_key")} />
                      </div>
                    </Field>
                    <Field label="Total tax">
                      <input value={s.total} onChange={(e) => patchStatement(s.localId, { total: e.target.value })} className={inputClass + ring(s, "total_tax")} />
                    </Field>
                    <Field label="Taxpayer (as printed)">
                      <input value={s.taxpayer} onChange={(e) => patchStatement(s.localId, { taxpayer: e.target.value })} className={inputClass + ring(s, "taxpayer_name")} />
                    </Field>
                    <Field label="C/O">
                      <input value={s.careOf} onChange={(e) => patchStatement(s.localId, { careOf: e.target.value })} className={inputClass + ring(s, "care_of")} />
                    </Field>
                    <Field label="Entity">
                      <select
                        value={s.entityId}
                        onChange={(e) => {
                          const id = e.target.value;
                          const ent = id ? entityById.get(id) : null;
                          patchStatement(s.localId, {
                            entityId: id,
                            entityEvidence: ent ? `Chosen by hand for "${s.comparedName ?? s.taxpayer}"` : null,
                          });
                        }}
                        className={inputClass}
                      >
                        <option value="">No entity</option>
                        {entities.map((e) => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                      {s.entityEvidence && s.entityId ? <p className="mt-1 text-xs text-gray-600">{s.entityEvidence}</p> : null}
                    </Field>
                    <Field label="Due date">
                      <input type="date" value={s.dueDate} onChange={(e) => patchStatement(s.localId, { dueDate: e.target.value })} className={inputClass + ring(s, "due_date")} />
                    </Field>
                    <Field label="Delinquent date">
                      <input type="date" value={s.delinquentDate} onChange={(e) => patchStatement(s.localId, { delinquentDate: e.target.value })} className={inputClass + ring(s, "delinquent_date")} />
                    </Field>
                    <Field label="Notes">
                      <input value={s.notes} onChange={(e) => patchStatement(s.localId, { notes: e.target.value })} className={inputClass} />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-700">
                    <input type="checkbox" checked={s.rememberDates} onChange={(e) => patchStatement(s.localId, { rememberDates: e.target.checked })} className="h-4 w-4 accent-kelly-500" />
                    Remember these due and delinquent dates for {s.county || "this county"}
                  </label>

                  {/* Lines */}
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-gray-800">Parcel lines</p>
                      <span className="text-xs text-gray-500">
                        Lines sum to {formatDollars(r.lineTotal)}
                        {r.gap !== null && !r.reconciled ? <span className="text-amber-800"> (gap {formatDollars(r.gap)} against the statement total)</span> : null}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patchStatement(s.localId, {
                            lines: [
                              ...s.lines,
                              {
                                localId: crypto.randomUUID(),
                                lineType: "real_property",
                                identifiers: [],
                                appraised: "",
                                assessed: "",
                                tax: "",
                                exemptions: "",
                                legal: "",
                                address: "",
                                acres: "",
                                mode: "unmatched",
                                parcelId: "",
                                matchSource: null,
                                evidence: null,
                                candidates: [],
                                newParcelNumber: "",
                                newParcelCounty: s.county,
                                newParcelPropertyId: properties[0]?.id ?? "",
                                legalOpen: false,
                              },
                            ],
                          })
                        }
                        className="ml-auto text-xs font-medium text-kelly-700 hover:underline"
                      >
                        + Add line
                      </button>
                    </div>
                    {s.lines.length === 0 ? <p className="text-xs text-gray-500">No parcel lines were read. Add them by hand.</p> : null}
                    <ul className="space-y-2">
                      {s.lines.map((l, i) => (
                        <LineCard
                          key={l.localId}
                          index={i}
                          line={l}
                          parcels={parcelList}
                          parcelById={parcelById}
                          properties={properties}
                          onChange={(patch) => patchLine(s.localId, l.localId, patch)}
                          onIdentifiersChanged={(ids) => rematch(s.localId, { ...l, identifiers: ids })}
                          onRemove={() => patchStatement(s.localId, { lines: s.lines.filter((x) => x.localId !== l.localId) })}
                        />
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => confirmStatement(s)}
                      disabled={s.status === "saving" || issues.some((x) => x !== "lines do not reconcile")}
                      className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
                    >
                      {s.status === "saving" ? "Saving..." : "Confirm statement"}
                    </button>
                    {!r.reconciled && r.gap !== null ? (
                      <span className="text-xs text-amber-900">The gap is kept on the statement and shown on the Property Taxes page.</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => patchStatement(s.localId, { status: "skipped", error: null, open: false })}
                      className="ml-auto text-xs font-medium text-gray-600 hover:underline"
                    >
                      Skip this statement
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {statements.length > 0 && reviewable.length === 0 && !busy ? (
        <p className="text-sm text-gray-700">
          All done.{" "}
          <Link href="/taxes" className="font-medium text-kelly-700 hover:underline">
            Open the Property Taxes page
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-gray-700">
      {label}
      <div className="mt-1 font-normal">{children}</div>
    </label>
  );
}

function LineCard({
  index,
  line,
  parcels,
  parcelById,
  properties,
  onChange,
  onIdentifiersChanged,
  onRemove,
}: {
  index: number;
  line: LineDraft;
  parcels: ParcelRef[];
  parcelById: Map<string, ParcelRef>;
  properties: Array<{ id: string; name: string }>;
  onChange: (patch: Partial<LineDraft>) => void;
  onIdentifiersChanged: (ids: PrintedIdentifier[]) => void;
  onRemove: () => void;
}) {
  const [addingId, setAddingId] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const isPP = line.lineType === "personal_property";
  const matched = line.mode === "matched" && line.parcelId ? parcelById.get(line.parcelId) : null;
  const cardBorder = isPP ? "border-gray-200" : line.mode === "matched" ? "border-kelly-200" : line.mode === "create" ? "border-gray-300" : "border-amber-300";

  function addIdentifier() {
    const id = printedIdentifier(newLabel, null, newValue);
    if (!id) return;
    const ids = [...line.identifiers, id];
    onChange({ identifiers: ids });
    onIdentifiersChanged(ids);
    setNewLabel("");
    setNewValue("");
    setAddingId(false);
  }

  return (
    <li className={`rounded-lg border ${cardBorder} p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">Line {index + 1}</span>
        <button
          type="button"
          onClick={() => onChange({ lineType: isPP ? "real_property" : "personal_property", mode: "unmatched", parcelId: "", matchSource: null, evidence: null })}
          className={"rounded-full px-2 py-0.5 text-xs font-medium " + (isPP ? "bg-gray-100 text-gray-700" : "bg-kelly-50 text-pine-900")}
          title="Tap to switch the line type"
        >
          {isPP ? "Personal property" : "Real property"}
        </button>
        {line.identifiers.map((id, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-800">
            <span className="text-gray-500">{id.label ?? IDENTIFIER_KIND_LABELS[id.kind]}:</span> {id.value}
            <button
              type="button"
              aria-label="Remove identifier"
              onClick={() => {
                const ids = line.identifiers.filter((_, j) => j !== i);
                onChange({ identifiers: ids });
                onIdentifiersChanged(ids);
              }}
              className="text-gray-400 hover:text-red-600"
            >
              x
            </button>
          </span>
        ))}
        {addingId ? (
          <span className="flex items-center gap-1">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label" className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Number as printed"
              className="w-36 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") addIdentifier();
                if (e.key === "Escape") setAddingId(false);
              }}
            />
            <button type="button" onClick={addIdentifier} className="text-xs font-medium text-kelly-700 hover:underline">Add</button>
          </span>
        ) : (
          <button type="button" onClick={() => setAddingId(true)} className="text-xs font-medium text-kelly-700 hover:underline">+ number</button>
        )}
        <button type="button" onClick={onRemove} className="ml-auto text-xs text-gray-500 hover:text-red-600">Remove line</button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="text-[11px] text-gray-600">
          Appraised
          <input value={line.appraised} onChange={(e) => onChange({ appraised: e.target.value })} className={smallInput} />
        </label>
        <label className="text-[11px] text-gray-600">
          Assessed
          <input value={line.assessed} onChange={(e) => onChange({ assessed: e.target.value })} className={smallInput} />
        </label>
        <label className="text-[11px] text-gray-600">
          Tax due
          <input value={line.tax} onChange={(e) => onChange({ tax: e.target.value })} className={smallInput} />
        </label>
        <label className="text-[11px] text-gray-600">
          Acres
          <input value={line.acres} onChange={(e) => onChange({ acres: e.target.value })} className={smallInput} />
        </label>
        <label className="text-[11px] text-gray-600">
          Exemptions
          <input value={line.exemptions} onChange={(e) => onChange({ exemptions: e.target.value })} className={smallInput} />
        </label>
      </div>
      {line.address ? <p className="mt-1 text-xs text-gray-600">{line.address}</p> : null}
      {line.legal ? (
        <button type="button" onClick={() => onChange({ legalOpen: !line.legalOpen })} className="mt-1 text-xs font-medium text-kelly-700 hover:underline">
          {line.legalOpen ? "Hide legal description" : "Legal description"}
        </button>
      ) : null}
      {line.legalOpen ? <p className="mt-1 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">{line.legal}</p> : null}

      {/* Match */}
      {isPP ? (
        <p className="mt-2 text-xs text-gray-500">Personal property: not tied to a parcel; counted under the statement&apos;s entity.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {matched ? (
            <p className="text-xs text-pine-900">
              <span className="font-medium">Matched:</span> {matched.parcel_number}
              {matched.property_name ? ` on ${matched.property_name}` : ""}
              {line.evidence ? <span className="text-gray-600"> · {line.evidence}</span> : null}
            </p>
          ) : line.candidates.length > 1 ? (
            <p className="text-xs text-amber-900">Several parcels match different numbers on this line; pick one.</p>
          ) : line.mode === "unmatched" ? (
            <p className="text-xs text-amber-900">No parcel matched. Pick one, create it, or leave it to resolve later.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={line.mode === "create" ? "__create" : line.mode === "matched" ? line.parcelId : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__create") onChange({ mode: "create", parcelId: "", matchSource: null });
                else if (!v) onChange({ mode: "unmatched", parcelId: "", matchSource: null, evidence: null });
                else {
                  const cand = line.candidates.find((c) => c.parcelId === v);
                  onChange({
                    mode: "matched",
                    parcelId: v,
                    matchSource: cand ? "identifier" : "manual",
                    evidence: cand?.evidence ?? "Matched by hand",
                  });
                }
              }}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
            >
              <option value="">Leave unmatched (resolve later)</option>
              {line.candidates.length > 1 ? (
                <optgroup label="Candidates from the printed numbers">
                  {line.candidates.map((c) => {
                    const p = parcelById.get(c.parcelId);
                    return (
                      <option key={c.parcelId} value={c.parcelId}>
                        {p?.parcel_number} {p?.property_name ? `· ${p.property_name}` : ""}
                      </option>
                    );
                  })}
                </optgroup>
              ) : null}
              <optgroup label="All parcels">
                {parcels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.parcel_number}
                    {p.county ? ` (${p.county})` : ""} {p.property_name ? `· ${p.property_name}` : ""}
                  </option>
                ))}
              </optgroup>
              <option value="__create">Create the parcel...</option>
            </select>
          </div>
          {line.mode === "create" ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input value={line.newParcelNumber} onChange={(e) => onChange({ newParcelNumber: e.target.value })} placeholder="Parcel number" className={smallInput} />
              <input value={line.newParcelCounty} onChange={(e) => onChange({ newParcelCounty: e.target.value })} placeholder="County" className={smallInput} />
              <select value={line.newParcelPropertyId} onChange={(e) => onChange({ newParcelPropertyId: e.target.value })} className={smallInput}>
                <option value="">Property...</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 sm:col-span-3">The boundary can be drawn or imported from county records later.</p>
            </div>
          ) : null}
        </div>
      )}
    </li>
  );
}
