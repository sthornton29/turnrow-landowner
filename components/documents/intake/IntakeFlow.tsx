"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { scanKindFor, type DocType } from "@/lib/documents";
import {
  verifyMatches,
  type MatchableEntity,
  type MatchableParcel,
  type MatchableProperty,
  type PropertySuggestion,
  type VerifiedMatches,
} from "@/lib/documentMatch";
import type { DocumentEntityType } from "@/types/db";
import {
  intakeFile,
  intakeStoragePath,
  largeFileWarning,
  uploadDocument,
  uploadErrorCopy,
  uploadToStorage,
  type IntakeResult,
} from "../classify";
import { finalizeValues, initialValuesFor } from "../ExtractedFieldsEditor";
import type { SelectableProperty } from "../PropertyMultiSelect";
import DropZone from "./DropZone";
import FilePreview from "./FilePreview";
import ConfirmScreen from "./ConfirmScreen";
import ManualForm from "./ManualForm";
import SavedPanel from "./SavedPanel";
import HandoffBanner from "./HandoffBanner";
import type { AttachOption, Draft, IntakeContextTarget } from "./types";

type Step = "upload" | "reading" | "confirm" | "manual" | "saving" | "saved";

interface Saved {
  id: string;
  docType: DocType;
  extracted: Record<string, unknown> | null;
  storagePath: string;
  propertyId: string | null;
  title: string;
}

// The single upload path: drop the file, confirm what the AI found,
// save. Used by the Documents page (no context) and by every entity
// page's Documents section (that page is the default attachment).
// Manual entry is one quiet link away at every step; any failure lands
// in the manual form with the file kept. Nothing saves until Save.
export default function IntakeFlow({
  orgId,
  context = null,
  onSaved,
  onClose,
}: {
  orgId: string;
  context?: IntakeContextTarget | null;
  onSaved: (documentId: string) => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [verified, setVerified] = useState<VerifiedMatches | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(context));
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [handoffDismissed, setHandoffDismissed] = useState(false);
  const [mismatchDismissed, setMismatchDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  // Matching context, loaded once: properties, parcels, entities and
  // their confirmed aliases. Session client; RLS scopes it.
  const [properties, setProperties] = useState<MatchableProperty[]>([]);
  const [propertyEntity, setPropertyEntity] = useState<Record<string, string | null>>({});
  const [parcels, setParcels] = useState<MatchableParcel[]>([]);
  const [entities, setEntities] = useState<MatchableEntity[]>([]);
  const [attachOptions, setAttachOptions] = useState<AttachOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, pc, e, a] = await Promise.all([
        supabase.from("properties").select("id, name, county, state, fsa_numbers, acres, entity_id").order("name"),
        supabase.from("parcels").select("id, property_id, parcel_number"),
        supabase.from("entities").select("id, name").order("name"),
        supabase.from("entity_aliases").select("entity_id, alias"),
      ]);
      if (cancelled) return;
      const props = (p.data ?? []) as Array<{ id: string; name: string; county: string | null; state: string | null; fsa_numbers: string[] | null; acres: number | string | null; entity_id: string | null }>;
      setProperties(
        props.map((x) => ({
          id: x.id,
          name: x.name,
          county: x.county,
          state: x.state,
          fsa_numbers: x.fsa_numbers ?? null,
          acres: x.acres === null || x.acres === undefined ? null : Number(x.acres),
        }))
      );
      setPropertyEntity(Object.fromEntries(props.map((x) => [x.id, x.entity_id ?? null])));
      setParcels(((pc.data ?? []) as MatchableParcel[]).map((x) => ({ id: x.id, property_id: x.property_id, parcel_number: x.parcel_number })));
      const aliasesBy = new Map<string, string[]>();
      for (const row of (a.data ?? []) as Array<{ entity_id: string; alias: string }>) {
        aliasesBy.set(row.entity_id, [...(aliasesBy.get(row.entity_id) ?? []), row.alias]);
      }
      setEntities(((e.data ?? []) as Array<{ id: string; name: string }>).map((x) => ({ id: x.id, name: x.name, aliases: aliasesBy.get(x.id) ?? [] })));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const loadAttachOptions = useCallback(async () => {
    if (attachOptions !== null) return;
    const [fields, stands, easements, assets, leases, sales] = await Promise.all([
      supabase.from("fields").select("id, name").order("name"),
      supabase.from("timber_stands").select("id, name").order("name"),
      supabase.from("easements").select("id, name").order("name"),
      supabase.from("assets").select("id, name").order("name"),
      supabase.from("leases").select("id, name").order("name"),
      supabase.from("timber_sales").select("id, sale_name").order("sale_name"),
    ]);
    const out: AttachOption[] = [];
    const push = (entityType: DocumentEntityType, rows: Array<{ id: string; name?: string | null; sale_name?: string | null }> | null) => {
      for (const r of rows ?? []) out.push({ entityType, id: r.id, label: r.name ?? r.sale_name ?? "" });
    };
    push("parcel", parcels.map((x) => ({ id: x.id, name: `Parcel ${x.parcel_number}` })));
    push("field", fields.data as Array<{ id: string; name: string }> | null);
    push("timber_stand", stands.data as Array<{ id: string; name: string }> | null);
    push("easement", easements.data as Array<{ id: string; name: string }> | null);
    push("asset", assets.data as Array<{ id: string; name: string }> | null);
    push("lease", leases.data as Array<{ id: string; name: string }> | null);
    push("timber_sale", sales.data as Array<{ id: string; sale_name: string }> | null);
    push("entity", entities.map((x) => ({ id: x.id, name: x.name })));
    setAttachOptions(out);
  }, [attachOptions, supabase, parcels, entities]);

  const selectable: SelectableProperty[] = useMemo(
    () => properties.map((p) => ({ id: p.id, name: p.name, county: p.county, state: p.state })),
    [properties]
  );

  // ---- step 1 -> 2: the AI pass
  // The storage object uploaded for the current file (reused on save,
  // removed if the user walks away without saving).
  const uploadedPathRef = useRef<string | null>(null);

  async function handleFile(f: File) {
    setFile(f);
    setError(null);
    setResult(null);
    setVerified(null);
    setHandoffDismissed(false);
    setMismatchDismissed(false);
    setStep("reading");
    // Upload FIRST (resumable over 6 MB), then the server reads the
    // file by path; the request body never carries the document.
    const path = intakeStoragePath(orgId, f);
    const upErr = await uploadToStorage(supabase, path, f);
    if (upErr) {
      setDraft(emptyDraft(context));
      setManualMessage(uploadErrorCopy(f.name, upErr));
      setStep("manual");
      return;
    }
    uploadedPathRef.current = path;
    const res = await intakeFile({ storagePath: path, fileName: f.name, contentType: f.type || "application/pdf" }, {
      properties: properties.map((p) => ({
        name: p.name,
        county: p.county,
        state: p.state,
        parcel_numbers: parcels.filter((pc) => pc.property_id === p.id).map((pc) => pc.parcel_number),
        fsa_numbers: p.fsa_numbers ?? [],
        acres: p.acres,
      })),
      entities: entities.map((e) => ({ name: e.name, aliases: e.aliases })),
    });
    if ("error" in res) {
      // Never a dead end: the manual form with the file attached.
      setDraft(emptyDraft(context));
      setManualMessage(res.error);
      setStep("manual");
      return;
    }
    const r = res.result;
    const v = verifyMatches(
      r.matched_properties,
      r.property_hints,
      properties,
      parcels,
      entities,
      r.matched_entity,
      propertyEntity,
      r.spatial ?? null
    );
    setResult(r);
    setVerified(v);
    const kind = scanKindFor(r.doc_type);
    const base = emptyDraft(context);
    // verifyMatches decides what is pre-checked: confident signals,
    // every overlapping property from the description, and NOTHING when
    // the signals conflict. Context wins silently when the AI agrees or
    // found nothing.
    const confident = v.preselect;
    const propertyIds = context
      ? base.propertyIds
      : confident;
    setDraft({
      ...base,
      docType: r.doc_type,
      title: r.title ?? "",
      propertyIds,
      entityId: !context && v.entity && confident.length === 0 ? v.entity.entityId : null,
      values: kind ? initialValuesFor(kind, r.fields) : {},
    });
    setStep("confirm");
  }

  // Re-seed the fields when the user changes the type on the confirm screen.
  function changeDraft(next: Draft) {
    if (result && next.docType !== draft.docType) {
      const kind = scanKindFor(next.docType);
      next = { ...next, values: kind ? initialValuesFor(kind, result.fields) : {} };
    }
    setDraft(next);
  }

  const suggestions: PropertySuggestion[] = verified?.verified ?? [];
  const entityMatch = verified?.entity
    ? { id: verified.entity.entityId, name: entities.find((e) => e.id === verified.entity!.entityId)?.name ?? "Entity", why: verified.entity.why }
    : null;

  // Context-aware mismatch: the context is a property (or sits on one)
  // and the strongest verified match is a different property.
  const mismatch = useMemo(() => {
    if (!context || !context.propertyId || mismatchDismissed || suggestions.length === 0) return null;
    const top = suggestions[0];
    if (top.score < 50 || top.propertyId === context.propertyId) return null;
    const name = properties.find((p) => p.id === top.propertyId)?.name ?? "another property";
    return { propertyId: top.propertyId, name, why: top.reasons.join("; ") };
  }, [context, mismatchDismissed, suggestions, properties]);
  const [switched, setSwitched] = useState(false);

  // ---- manual path
  function goManual() {
    const hasProposals = step === "confirm" && result !== null;
    let keep = false;
    if (hasProposals) {
      keep = window.confirm("Keep the AI's suggestions as starting values? OK keeps them, Cancel starts blank.");
    }
    if (!keep) setDraft(emptyDraft(context));
    setResult(null);
    setVerified(null);
    setManualMessage(null);
    setStep("manual");
  }

  // ---- step 3: save
  async function save() {
    if (!file) return;
    setStep("saving");
    setError(null);
    const kind = scanKindFor(draft.docType);
    let extracted: Record<string, unknown> | null = null;
    if (kind) {
      const out = finalizeValues(kind, draft.values);
      const hasAny = Object.entries(out).some(([k, v]) =>
        k !== "scan_kind" && k !== "unsure_fields" && v !== null && !(Array.isArray(v) && v.length === 0)
      );
      if (hasAny || result) {
        if (result?.pages_scanned != null) out.pages_scanned = result.pages_scanned;
        if (result?.total_pages != null) out.total_pages = result.total_pages;
        extracted = out;
      }
    }
    // Primary attachment: the page's record when uploading from one
    // (unless the user switched to the AI's property), else the chosen
    // specific record, else the first property, else the entity, else
    // Unfiled.
    let entityType: DocumentEntityType = "organization";
    let entityId = orgId;
    let propertyIds = [...draft.propertyIds];
    if (context && !switched) {
      entityType = context.entityType;
      entityId = context.entityId;
      if (context.propertyId) propertyIds = [...new Set([context.propertyId, ...propertyIds])];
    } else if (draft.extra) {
      entityType = draft.extra.entityType;
      entityId = draft.extra.id;
    } else if (propertyIds.length > 0) {
      entityType = "property";
      entityId = propertyIds[0];
    } else if (draft.entityId && entityMatch) {
      entityType = "entity";
      entityId = entityMatch.id;
    }
    const res = await uploadDocument(supabase, {
      orgId,
      entityType,
      entityId,
      file,
      docType: draft.docType,
      title: draft.title.trim() || null,
      aiSuggestedType: result?.doc_type ?? null,
      propertyIds,
      extracted,
      storagePath: uploadedPathRef.current,
    });
    if ("error" in res) {
      setError(res.error);
      setStep(result ? "confirm" : "manual");
      return;
    }
    const path = await supabase.from("documents").select("storage_path").eq("id", res.id).single();
    setSaved({
      id: res.id,
      docType: draft.docType,
      extracted,
      storagePath: (path.data?.storage_path as string) ?? "",
      propertyId: propertyIds[0] ?? null,
      title: draft.title.trim() || file.name,
    });
    setStep("saved");
    onSaved(res.id);
  }

  function reset() {
    // Walking away from an unsaved file: drop its storage object.
    if (uploadedPathRef.current && !saved) {
      const stale = uploadedPathRef.current;
      supabase.storage.from("documents").remove([stale]).then(() => undefined, () => undefined);
    }
    uploadedPathRef.current = null;
    setFile(null);
    setResult(null);
    setVerified(null);
    setDraft(emptyDraft(context));
    setManualMessage(null);
    setError(null);
    setSaved(null);
    setSwitched(false);
    setStep("upload");
  }

  const bigNote = file ? largeFileWarning(file) : null;

  return (
    <div className="space-y-3">
      {step === "upload" ? (
        <DropZone
          onFile={handleFile}
          onManual={goManual}
          intro={context ? `Adding to ${context.label}.` : null}
        />
      ) : null}

      {step === "reading" && file ? (
        <div className="grid gap-4 md:grid-cols-2">
          <FilePreview file={file} compact />
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900">Reading the document...</p>
            <p className="text-xs text-gray-600">
              Working out what it is, pulling its key fields, and checking it against your properties
              {properties.length > 0 ? ` (${properties.length})` : ""}. Long packets take a minute or two.
            </p>
            {bigNote ? <p className="text-xs text-amber-800">{bigNote}</p> : null}
            <div className="h-1.5 w-full overflow-hidden rounded bg-gray-200">
              <div className="h-full w-1/3 animate-pulse rounded bg-kelly-500" />
            </div>
            <button
              type="button"
              onClick={goManual}
              className="rounded-lg border-2 border-pine-800 bg-white px-4 py-2 text-sm font-semibold text-pine-900 hover:bg-kelly-50"
            >
              Skip the AI: manual upload
            </button>
          </div>
        </div>
      ) : null}

      {(step === "confirm" || step === "manual" || step === "saving") && file ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="md:sticky md:top-4 md:self-start">
            <FilePreview file={file} compact={step === "manual"} />
          </div>
          <div className="space-y-3">
            {step !== "manual" && result?.specialized_kind && !handoffDismissed ? (
              <HandoffBanner kind={result.specialized_kind} file={file} onDismiss={() => setHandoffDismissed(true)} />
            ) : null}
            {step === "manual" ? (
              <ManualForm
                draft={draft}
                onChange={setDraft}
                properties={selectable}
                context={context}
                attachOptions={attachOptions}
                loadAttachOptions={loadAttachOptions}
                message={manualMessage}
              />
            ) : result ? (
              <ConfirmScreen
                result={result}
                draft={draft}
                onChange={changeDraft}
                properties={selectable}
                suggestions={suggestions}
                spatial={result.spatial ?? null}
                conflict={verified?.conflict ?? false}
                entityWhy={entityMatch?.why ?? null}
                entityName={entityMatch?.name ?? null}
                context={context}
                mismatch={switched ? null : mismatch}
                onSwitchToMatch={() => {
                  if (!mismatch) return;
                  setSwitched(true);
                  setMismatchDismissed(true);
                  setDraft({ ...draft, propertyIds: [mismatch.propertyId] });
                }}
                onKeepBoth={() => {
                  if (!mismatch) return;
                  setMismatchDismissed(true);
                  setDraft({ ...draft, propertyIds: [...new Set([...draft.propertyIds, mismatch.propertyId])] });
                }}
                attachOptions={attachOptions}
                loadAttachOptions={loadAttachOptions}
              />
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={step === "saving"}
                className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
              >
                {step === "saving" ? "Saving..." : "Save document"}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={step === "saving"}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Start over
              </button>
              {step === "confirm" ? (
                <button
                  type="button"
                  onClick={goManual}
                  className="ml-auto rounded-lg border-2 border-pine-800 bg-white px-3 py-2 text-sm font-semibold text-pine-900 hover:bg-kelly-50"
                >
                  Switch to manual upload
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {step === "saved" && saved ? (
        <SavedPanel
          documentId={saved.id}
          orgId={orgId}
          docType={saved.docType}
          scanKind={scanKindFor(saved.docType)}
          extracted={saved.extracted}
          storagePath={saved.storagePath}
          propertyId={saved.propertyId}
          title={saved.title}
          onUploadAnother={reset}
          onDone={onClose}
        />
      ) : null}
    </div>
  );
}

function emptyDraft(context: IntakeContextTarget | null): Draft {
  return {
    docType: "other",
    title: "",
    propertyIds: context?.propertyId ? [context.propertyId] : [],
    entityId: null,
    extra: null,
    values: {},
  };
}
