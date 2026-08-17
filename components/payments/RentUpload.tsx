"use client";

// "Upload rent received": check images and settlement PDFs in, reviewed
// payment rows out. Extraction (claude-sonnet-4-6 via /api/extract
// kind=payment) suggests the payer's tenant, that tenant's lease, and
// an allocation against OPEN expected payments (exact-amount match
// first, then due-date proximity; splits and partials supported). A
// document reading as a timber settlement can route to a pay-as-cut
// settlement on the matching timber sale instead. EVERYTHING is
// reviewed before saving; the source file attaches to the lease or
// sale, and provenance lands in the payment memo.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  CLUSTER_THRESHOLD,
  normalizeOwnerName,
  ownerSimilarity,
} from "@/lib/ownerNames";
import { sameCrop } from "@/lib/crops";
import { cropAssumptions, type YearAssumptions } from "@/lib/leaseLogic";
import {
  proposeAllocation,
  type OpenExpectedPayment,
} from "@/lib/paymentMatch";

interface Tenant {
  id: string;
  name: string;
}
interface Lease {
  id: string;
  name: string;
  tenant_id: string;
  status: string;
}
interface TimberSale {
  id: string;
  sale_name: string;
  buyer_tenant_id: string | null;
  sale_type: string;
}
interface ExpectedRow {
  id: string;
  lease_id: string | null;
  label: string;
  due_date: string;
  expected_amount: number;
}

interface Extraction {
  document_kind: "check" | "settlement" | "timber_settlement" | "other";
  payer_name: string | null;
  date: string | null;
  total_amount: number | null;
  check_number: string | null;
  memo: string | null;
  lines: Array<{
    crop: string | null;
    units: number | null;
    unit: string | null;
    price_per_unit: number | null;
    share_pct: number | null;
    amount: number | null;
  }>;
  yields: Array<{
    crop: string;
    yield_per_acre: number | null;
    acres: number | null;
    price_per_unit: number | null;
  }>;
  timber_lines: Array<{
    product: string;
    tons: number | null;
    price_per_ton: number | null;
    amount: number | null;
  }>;
  unsure_fields: string[];
}

interface Item {
  localId: string;
  file: File;
  status: "extracting" | "review" | "saving" | "saved" | "error";
  error: string | null;
  extraction: Extraction | null;
  // editable review state
  payerName: string;
  date: string;
  amount: string;
  checkNumber: string;
  tenantId: string;
  tenantSuggested: boolean;
  leaseId: string;
  mode: "lease" | "timber";
  timberSaleId: string;
  allocations: Record<string, string>; // expectedId -> dollars string
}

const inputClass = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";
const amberClass = "rounded-lg border border-amber-400 bg-amber-50 px-2 py-1.5 text-sm";

export default function RentUpload({
  orgId,
  defaultLeaseId = null,
}: {
  orgId: string;
  defaultLeaseId?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [sales, setSales] = useState<TimberSale[]>([]);
  const [expected, setExpected] = useState<ExpectedRow[]>([]);
  const [receivedByExpected, setReceivedByExpected] = useState<Map<string, number>>(
    new Map()
  );
  const [assumptionsByLease, setAssumptionsByLease] = useState<
    Map<string, YearAssumptions>
  >(new Map());

  useEffect(() => {
    if (!open) return;
    (async () => {
      const year = new Date().getFullYear();
      const [t, l, s, e, p, a] = await Promise.all([
        supabase.from("tenants").select("id, name").order("name"),
        supabase.from("leases").select("id, name, tenant_id, status"),
        supabase.from("timber_sales").select("id, sale_name, buyer_tenant_id, sale_type"),
        supabase
          .from("expected_payments")
          .select("id, lease_id, label, due_date, expected_amount")
          .not("lease_id", "is", null),
        supabase.from("payments").select("expected_payment_id, amount"),
        supabase
          .from("lease_year_assumptions")
          .select("lease_id, year, data")
          .eq("year", year),
      ]);
      setTenants((t.data as Tenant[]) ?? []);
      setLeases((l.data as Lease[]) ?? []);
      setSales((s.data as TimberSale[]) ?? []);
      setExpected((e.data as ExpectedRow[]) ?? []);
      const rec = new Map<string, number>();
      for (const row of (p.data as Array<{ expected_payment_id: string | null; amount: number }>) ?? []) {
        if (row.expected_payment_id) {
          rec.set(row.expected_payment_id, (rec.get(row.expected_payment_id) ?? 0) + row.amount);
        }
      }
      setReceivedByExpected(rec);
      setAssumptionsByLease(
        new Map(
          ((a.data as Array<{ lease_id: string; data: YearAssumptions }>) ?? []).map(
            (row) => [row.lease_id, row.data ?? {}]
          )
        )
      );
    })();
  }, [open, supabase]);

  function openLeaseExpected(leaseId: string): OpenExpectedPayment[] {
    return expected
      .filter((e) => e.lease_id === leaseId)
      .map((e) => ({
        id: e.id,
        label: e.label,
        due_date: e.due_date,
        expected_amount: e.expected_amount,
        received_total: receivedByExpected.get(e.id) ?? 0,
      }))
      .filter((e) => e.expected_amount - e.received_total > 0.005);
  }

  function suggestTenant(payer: string | null): string {
    if (!payer) return "";
    const normalized = normalizeOwnerName(payer).normalized;
    let best: { id: string; score: number } | null = null;
    for (const t of tenants) {
      const score = ownerSimilarity(normalized, normalizeOwnerName(t.name).normalized);
      if (!best || score > best.score) best = { id: t.id, score };
    }
    return best && best.score >= CLUSTER_THRESHOLD ? best.id : "";
  }

  function applyProposal(item: Item): Item {
    const amount = Number(item.amount) || 0;
    if (!item.leaseId || amount <= 0) return { ...item, allocations: {} };
    const proposal = proposeAllocation(amount, item.date || null, openLeaseExpected(item.leaseId));
    const allocations: Record<string, string> = {};
    for (const line of proposal.lines) allocations[line.expectedId] = String(line.amount);
    return { ...item, allocations };
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const localId = crypto.randomUUID();
      setItems((prev) => [
        ...prev,
        {
          localId, file, status: "extracting", error: null, extraction: null,
          payerName: "", date: "", amount: "", checkNumber: "",
          tenantId: "", tenantSuggested: false, leaseId: defaultLeaseId ?? "",
          mode: "lease", timberSaleId: "", allocations: {},
        },
      ]);
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "payment");
      try {
        const res = await fetch("/api/extract", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Extraction failed.");
        const x = body.extraction as Extraction;
        setItems((prev) =>
          prev.map((it) => {
            if (it.localId !== localId) return it;
            const tenantId = suggestTenant(x.payer_name);
            const tenantLeases = leases.filter((l) => l.tenant_id === tenantId);
            const leaseId =
              defaultLeaseId ??
              (tenantLeases.length === 1
                ? tenantLeases[0].id
                : (tenantLeases.find((l) => l.status === "active")?.id ?? ""));
            const isTimber = x.document_kind === "timber_settlement" && sales.length > 0;
            const timberSaleId = isTimber
              ? (sales.find((s) => s.buyer_tenant_id === tenantId)?.id ?? sales[0]?.id ?? "")
              : "";
            const next: Item = {
              ...it,
              status: "review",
              extraction: x,
              payerName: x.payer_name ?? "",
              date: x.date ?? "",
              amount: x.total_amount != null ? String(x.total_amount) : "",
              checkNumber: x.check_number ?? "",
              tenantId,
              tenantSuggested: Boolean(tenantId),
              leaseId,
              mode: isTimber ? "timber" : "lease",
              timberSaleId,
            };
            return next.mode === "lease" ? applyProposal(next) : next;
          })
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? {
                  ...it,
                  status: "review",
                  error:
                    (err instanceof Error ? err.message : "Extraction failed.") +
                    " Fill everything in manually.",
                  extraction: null,
                }
              : it
          )
        );
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function patch(localId: string, changes: Partial<Item>, reallocate = false) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.localId !== localId) return it;
        const next = { ...it, ...changes };
        return reallocate ? applyProposal(next) : next;
      })
    );
  }

  async function attachDocument(
    item: Item,
    entityType: "lease" | "timber_sale",
    entityId: string
  ): Promise<string | null> {
    const path = `${orgId}/${entityType}/${crypto.randomUUID()}-${item.file.name}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, item.file, { contentType: item.file.type || undefined });
    if (upErr) return `Could not upload the document: ${upErr.message}`;
    const { error: insErr } = await supabase.from("documents").insert({
      organization_id: orgId,
      entity_type: entityType,
      entity_id: entityId,
      file_name: item.file.name,
      storage_path: path,
      content_type: item.file.type || null,
      size_bytes: item.file.size,
    });
    return insErr ? `Could not save the document row: ${insErr.message}` : null;
  }

  async function saveItem(item: Item) {
    patch(item.localId, { status: "saving", error: null });
    const provenance = `Uploaded ${item.extraction?.document_kind ?? "document"} "${item.file.name}", extracted ${new Date().toISOString().slice(0, 10)}`;
    const fail = (message: string) =>
      patch(item.localId, { status: "review", error: message });

    if (item.mode === "timber") {
      if (!item.timberSaleId) return fail("Pick the timber sale first.");
      const lines = (item.extraction?.timber_lines ?? [])
        .filter((l) => l.amount != null || (l.tons != null && l.price_per_ton != null))
        .map((l) => ({
          product: l.product.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          label: l.product,
          tons: l.tons ?? 0,
          price_per_ton: l.price_per_ton ?? 0,
          amount: l.amount ?? Math.round((l.tons ?? 0) * (l.price_per_ton ?? 0) * 100) / 100,
        }));
      const { error } = await supabase.from("timber_settlements").insert({
        organization_id: orgId,
        timber_sale_id: item.timberSaleId,
        settlement_date: item.date || new Date().toISOString().slice(0, 10),
        lines,
        total_amount: Number(item.amount) || 0,
        check_number: item.checkNumber || null,
        memo: provenance,
      });
      if (error) return fail("Could not save the settlement: " + error.message);
      const docErr = await attachDocument(item, "timber_sale", item.timberSaleId);
      if (docErr) return fail("Settlement saved, but " + docErr);
      patch(item.localId, { status: "saved" });
      router.refresh();
      return;
    }

    if (!item.leaseId) return fail("Pick the lease first (or the tenant to narrow it).");
    const total = Number(item.amount) || 0;
    if (total <= 0) return fail("Enter the amount received.");
    const date = item.date || new Date().toISOString().slice(0, 10);
    const allocationEntries = Object.entries(item.allocations)
      .map(([expectedId, v]) => ({ expectedId, amount: Number(v) || 0 }))
      .filter((a) => a.amount > 0);
    const allocated = allocationEntries.reduce((s, a) => s + a.amount, 0);
    if (allocated - total > 0.01) {
      return fail("The allocations add up to more than the check amount.");
    }
    const leftover = Math.round((total - allocated) * 100) / 100;

    const rows = [
      ...allocationEntries.map((a) => ({
        organization_id: orgId,
        lease_id: item.leaseId,
        timber_sale_id: null,
        expected_payment_id: a.expectedId,
        received_date: date,
        amount: a.amount,
        method: item.checkNumber ? `check #${item.checkNumber}` : null,
        memo: provenance,
      })),
      ...(leftover > 0.005
        ? [
            {
              organization_id: orgId,
              lease_id: item.leaseId,
              timber_sale_id: null,
              expected_payment_id: null,
              received_date: date,
              amount: leftover,
              method: item.checkNumber ? `check #${item.checkNumber}` : null,
              memo: provenance + (allocationEntries.length > 0 ? " (unscheduled remainder)" : ""),
            },
          ]
        : []),
    ];
    if (rows.length === 0) return fail("Nothing to record: allocate the amount first.");
    const { error } = await supabase.from("payments").insert(rows);
    if (error) return fail("Could not record the payment: " + error.message);
    const docErr = await attachDocument(item, "lease", item.leaseId);
    if (docErr) return fail("Payment saved, but " + docErr);
    patch(item.localId, { status: "saved" });
    router.refresh();
  }

  const unsure = (item: Item, key: string) =>
    item.extraction?.unsure_fields?.includes(key) ? amberClass : inputClass;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-kelly-500 px-3 py-1.5 text-sm font-medium text-kelly-700 hover:bg-kelly-50"
      >
        Upload rent received
      </button>
      {open ? (
        <div className="mt-3 w-full space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">
            Check photos and settlement PDFs. The extraction suggests the
            tenant, lease, and how the money lands on open expected payments;
            you review and adjust everything before it saves.
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => handleFiles(e.target.files)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-kelly-500 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-kelly-600"
          />

          {items.map((item) => {
            const tenantLeases = item.tenantId
              ? leases.filter((l) => l.tenant_id === item.tenantId)
              : leases;
            const openRows = item.leaseId ? openLeaseExpected(item.leaseId) : [];
            const allocated = Object.values(item.allocations).reduce(
              (s, v) => s + (Number(v) || 0),
              0
            );
            const total = Number(item.amount) || 0;
            const leftover = Math.round((total - allocated) * 100) / 100;
            const leaseAssumptions = item.leaseId
              ? cropAssumptions(assumptionsByLease.get(item.leaseId))
              : [];
            return (
              <div
                key={item.localId}
                className="space-y-2 rounded-lg border border-gray-200 p-3"
              >
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-gray-900">{item.file.name}</span>
                  {item.extraction ? (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                      {item.extraction.document_kind.replace("_", " ")}
                    </span>
                  ) : null}
                  {item.status === "extracting" ? (
                    <span className="text-xs text-gray-500">Extracting...</span>
                  ) : null}
                  {item.status === "saved" ? (
                    <span className="rounded-full bg-kelly-50 px-2 py-0.5 text-xs font-medium text-pine-900">
                      Saved
                    </span>
                  ) : null}
                </p>
                {item.error ? <p className="text-sm text-red-600">{item.error}</p> : null}

                {item.status === "review" || item.status === "saving" ? (
                  <>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-gray-600">
                        Payer
                        <input
                          value={item.payerName}
                          onChange={(e) => patch(item.localId, { payerName: e.target.value })}
                          className={`${unsure(item, "payer_name")} block w-40`}
                        />
                      </label>
                      <label className="text-xs text-gray-600">
                        Date
                        <input
                          type="date"
                          value={item.date}
                          onChange={(e) => patch(item.localId, { date: e.target.value }, true)}
                          className={`${unsure(item, "date")} block`}
                        />
                      </label>
                      <label className="text-xs text-gray-600">
                        Amount $
                        <input
                          type="number"
                          step="0.01"
                          value={item.amount}
                          onChange={(e) => patch(item.localId, { amount: e.target.value }, true)}
                          className={`${unsure(item, "total_amount")} block w-28`}
                        />
                      </label>
                      <label className="text-xs text-gray-600">
                        Check #
                        <input
                          value={item.checkNumber}
                          onChange={(e) => patch(item.localId, { checkNumber: e.target.value })}
                          className={`${unsure(item, "check_number")} block w-24`}
                        />
                      </label>
                    </div>

                    {item.extraction?.document_kind === "timber_settlement" && sales.length > 0 ? (
                      <div className="flex gap-1.5">
                        {(
                          [
                            ["lease", "Lease payment"],
                            ["timber", "Timber settlement"],
                          ] as Array<["lease" | "timber", string]>
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            onClick={() => patch(item.localId, { mode }, mode === "lease")}
                            className={
                              "rounded-lg border px-2.5 py-1 text-xs font-medium " +
                              (item.mode === mode
                                ? "border-kelly-500 bg-kelly-50 text-pine-900"
                                : "border-gray-300 text-gray-600")
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {item.mode === "timber" ? (
                      <div className="space-y-1.5">
                        <label className="block text-xs text-gray-600">
                          Timber sale (pay as cut)
                          <select
                            value={item.timberSaleId}
                            onChange={(e) => patch(item.localId, { timberSaleId: e.target.value })}
                            className={`${inputClass} mt-0.5 block w-full`}
                          >
                            <option value="">Pick a sale...</option>
                            {sales.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.sale_name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {(item.extraction?.timber_lines ?? []).length > 0 ? (
                          <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-700">
                            {(item.extraction?.timber_lines ?? []).map((l, i) => (
                              <p key={i}>
                                {l.product}: {formatNumber(l.tons ?? 0)} tons at{" "}
                                {formatDollars(l.price_per_ton ?? 0)}/ton
                                {l.amount != null ? ` = ${formatDollars(l.amount)}` : ""}
                              </p>
                            ))}
                            <p className="mt-1 text-gray-500">
                              Saves as a settlement on the sale for review there.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <label className="text-xs text-gray-600">
                            Tenant
                            {item.tenantSuggested ? (
                              <span className="ml-1 rounded-full bg-kelly-100 px-1.5 py-0.5 text-[10px] font-medium text-kelly-700">
                                Suggested from payer
                              </span>
                            ) : null}
                            <select
                              value={item.tenantId}
                              onChange={(e) => {
                                const tenantId = e.target.value;
                                const tl = leases.filter((l) => l.tenant_id === tenantId);
                                patch(
                                  item.localId,
                                  {
                                    tenantId,
                                    tenantSuggested: false,
                                    leaseId: tl.length === 1 ? tl[0].id : "",
                                  },
                                  true
                                );
                              }}
                              className={`${inputClass} mt-0.5 block w-48`}
                            >
                              <option value="">Pick a tenant...</option>
                              {tenants.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs text-gray-600">
                            Lease
                            <select
                              value={item.leaseId}
                              onChange={(e) => patch(item.localId, { leaseId: e.target.value }, true)}
                              className={`${inputClass} mt-0.5 block w-56`}
                            >
                              <option value="">Pick a lease...</option>
                              {tenantLeases.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        {item.leaseId ? (
                          openRows.length > 0 ? (
                            <div className="space-y-1 rounded-lg bg-gray-50 p-2">
                              <p className="text-xs font-medium text-gray-700">
                                Allocate against open expected payments
                              </p>
                              {openRows.map((e) => (
                                <div
                                  key={e.id}
                                  className="flex flex-wrap items-center gap-2 text-xs text-gray-700"
                                >
                                  <span>
                                    {e.label} · due {e.due_date} ·{" "}
                                    {formatDollars(e.expected_amount - e.received_total)} open
                                  </span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={item.allocations[e.id] ?? ""}
                                    onChange={(ev) =>
                                      patch(item.localId, {
                                        allocations: {
                                          ...item.allocations,
                                          [e.id]: ev.target.value,
                                        },
                                      })
                                    }
                                    placeholder="0.00"
                                    className="ml-auto w-24 rounded border border-gray-300 px-1.5 py-0.5 text-right"
                                  />
                                </div>
                              ))}
                              <p className="text-xs text-gray-500">
                                {leftover > 0.005
                                  ? `${formatDollars(leftover)} unallocated: records as an unscheduled payment.`
                                  : leftover < -0.005
                                    ? "Allocations exceed the check amount."
                                    : "Fully allocated."}
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-500">
                              No open expected payments on this lease; records as an
                              unscheduled payment.
                            </p>
                          )
                        ) : null}

                        {(item.extraction?.yields ?? []).length > 0 && item.leaseId ? (
                          <div className="rounded-lg border border-sky-100 bg-sky-50 p-2 text-xs text-sky-900">
                            <p className="font-medium">
                              Optional cross-check against this year{"'"}s assumptions
                              (nothing changes unless you edit the lease):
                            </p>
                            {(item.extraction?.yields ?? []).map((y, i) => {
                              const match = leaseAssumptions.find((a) =>
                                sameCrop(a.crop, y.crop)
                              );
                              return (
                                <p key={i}>
                                  Settlement shows {y.crop}
                                  {y.yield_per_acre != null
                                    ? ` ${formatNumber(y.yield_per_acre)}/ac`
                                    : ""}
                                  {y.acres != null ? ` on ${formatAcres(y.acres)} ac` : ""}
                                  {y.price_per_unit != null
                                    ? ` at ${formatDollars(y.price_per_unit)}`
                                    : ""}
                                  {match?.expected_yield != null
                                    ? `; your assumption is ${formatNumber(match.expected_yield)}/ac`
                                    : ""}
                                  {match?.expected_price != null && y.price_per_unit != null
                                    ? ` and ${formatDollars(match.expected_price)}`
                                    : ""}
                                  .
                                </p>
                              );
                            })}
                          </div>
                        ) : null}
                      </>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => saveItem(item)}
                        disabled={item.status === "saving"}
                        className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
                      >
                        {item.status === "saving"
                          ? "Saving..."
                          : item.mode === "timber"
                            ? "Save settlement"
                            : "Record payment"}
                      </button>
                      <button
                        onClick={() =>
                          setItems((prev) => prev.filter((x) => x.localId !== item.localId))
                        }
                        className="text-sm text-gray-500 hover:underline"
                      >
                        Discard
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
