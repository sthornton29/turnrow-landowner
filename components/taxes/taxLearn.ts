"use client";

// The self-learning writes behind every confirmation, shared by the
// upload review and the Property Taxes page's line-level resolve:
//   confirmLineParcel   link a line to a parcel and remember every
//                       identifier printed on that line on the parcel
//                       (and, when the county's GIS resolved the line,
//                       the identifiers and attributes the county
//                       returned, as county records)
//   confirmStatementEntity  link a statement to an entity, register the
//                       county + account to it, and save the printed
//                       taxpayer spelling as an alias when new
// Nothing here runs without a user confirmation upstream.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeOwnerName } from "@/lib/ownerNames";
import { normalizeIdentifier, type PrintedIdentifier, type StoredIdentifier } from "@/lib/taxIdentifiers";
import { aliasToLearn, identifiersToLearn, type CountyLookupHit, type MatchableEntityRef } from "@/lib/taxMatch";

export async function loadStoredIdentifiers(supabase: SupabaseClient): Promise<StoredIdentifier[]> {
  const { data } = await supabase.from("parcel_identifiers").select("parcel_id, kind, value, normalized");
  return ((data ?? []) as StoredIdentifier[]).map((r) => ({ ...r }));
}

// What the county's GIS service returned for the line (the live lookup
// tier, migration 0042): stored on the parcel as county records so the
// next statement matches locally without asking the county again.
export interface CountyLearn {
  serviceId: string;
  serviceLabel: string;
  identifiers: PrintedIdentifier[];
  attributes: Record<string, unknown> | null;
}

export async function confirmLineParcel(
  supabase: SupabaseClient,
  args: {
    orgId: string;
    lineId: string;
    parcelId: string | null; // null = explicitly unmatched (resolve later)
    identifiers: PrintedIdentifier[];
    source: "identifier" | "manual" | "name" | "spatial";
    evidence: string | null;
    stored?: StoredIdentifier[];
    // Save the printed identifiers to the parcel (default on; the manual
    // match controls let the user decline).
    learn?: boolean;
    county?: CountyLearn | null;
  }
): Promise<string | null> {
  const { error } = await supabase
    .from("tax_statement_lines")
    .update({
      parcel_id: args.parcelId,
      match_source: args.parcelId ? args.source : null,
      match_evidence: args.parcelId ? args.evidence : null,
      confirmed: true,
    })
    .eq("id", args.lineId);
  if (error) return error.message;
  if (!args.parcelId) return null;
  const now = new Date().toISOString();
  const stored = args.stored ?? (await loadStoredIdentifiers(supabase));
  if (args.learn !== false) {
    const learned = identifiersToLearn(args.parcelId, args.identifiers, stored);
    if (learned.length > 0) {
      const { error: idErr } = await supabase.from("parcel_identifiers").upsert(
        learned.map((l) => ({
          organization_id: args.orgId,
          parcel_id: l.parcel_id,
          kind: l.kind,
          label: l.label,
          value: l.value,
          normalized: l.normalized,
          source: "tax_statement",
          source_ref: args.lineId,
          last_seen_at: now,
        })),
        { onConflict: "parcel_id,kind,normalized" }
      );
      if (idErr) return idErr.message;
    }
  }
  if (args.county) {
    // Dedupe against what the printed pass just wrote too, so a number
    // both printed and returned by the county keeps its statement
    // provenance instead of being rewritten as a county record.
    const fromCounty = identifiersToLearn(args.parcelId, args.county.identifiers, [
      ...stored,
      ...(args.learn !== false ? identifiersToLearn(args.parcelId, args.identifiers, stored) : []),
    ]);
    if (fromCounty.length > 0) {
      const { error: cErr } = await supabase.from("parcel_identifiers").upsert(
        fromCounty.map((l) => ({
          organization_id: args.orgId,
          parcel_id: l.parcel_id,
          kind: l.kind,
          label: l.label,
          value: l.value,
          normalized: l.normalized,
          source: "county_import",
          source_ref: args.county!.serviceId,
          last_seen_at: now,
        })),
        { onConflict: "parcel_id,kind,normalized" }
      );
      if (cErr) return cErr.message;
    }
    if (args.county.attributes && Object.keys(args.county.attributes).length > 0) {
      // Attributes fill in only where the parcel has none; a county
      // import's fuller record is never overwritten by a lookup.
      const { data: cur } = await supabase.from("parcels").select("attributes").eq("id", args.parcelId).maybeSingle();
      if (!cur?.attributes) {
        const { error: aErr } = await supabase
          .from("parcels")
          .update({ attributes: args.county.attributes, attributes_source: args.county.serviceLabel, attributes_fetched_at: now })
          .eq("id", args.parcelId);
        if (aErr) return aErr.message;
      }
    }
  }
  return null;
}

export async function confirmStatementEntity(
  supabase: SupabaseClient,
  args: {
    orgId: string;
    statementId: string;
    entity: MatchableEntityRef | null;
    evidence: string | null;
    county: string | null;
    state: string | null;
    accountNumber: string | null;
    comparedName: string | null; // the name that matched (C/O target or taxpayer)
  }
): Promise<string | null> {
  const { error } = await supabase
    .from("tax_statements")
    .update({ entity_id: args.entity?.id ?? null, entity_evidence: args.entity ? args.evidence : null })
    .eq("id", args.statementId);
  if (error) return error.message;
  if (!args.entity) return null;
  const acct = normalizeIdentifier(args.accountNumber);
  if (acct && args.county) {
    const { error: accErr } = await supabase.from("entity_accounts").upsert(
      {
        organization_id: args.orgId,
        county: args.county.trim(),
        state: (args.state ?? "").trim().toUpperCase(),
        account_number: acct,
        account_printed: args.accountNumber,
        entity_id: args.entity.id,
        taxpayer_name_printed: args.comparedName,
        confirmed_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,county,state,account_number" }
    );
    if (accErr) return accErr.message;
  }
  const alias = aliasToLearn(args.comparedName, args.entity);
  if (alias) {
    // Per-org uniqueness on the normalized alias: another entity's
    // spelling is never stolen (ignoreDuplicates).
    await supabase.from("entity_aliases").upsert(
      {
        organization_id: args.orgId,
        entity_id: args.entity.id,
        alias,
        normalized_alias: normalizeOwnerName(alias).normalized,
        source_county: args.county,
        source_state: args.state,
      },
      { onConflict: "organization_id,normalized_alias", ignoreDuplicates: true }
    );
  }
  return null;
}

// ---------------------------------------------------------------- county lookup client

// One call per statement (or per Unmatched batch) to the live lookup
// tier; results are cached per session by county + kind + value so a
// re-render or a second statement in the same county never re-asks.
export interface CountyLookupResponse {
  service: { id: string; display_name: string } | null;
  reason?: "no_service" | "no_mapping";
  results: Array<{ key: string; hits: CountyLookupHit[] }>;
  error?: string;
}

const LOOKUP_CHUNK = 40;

export async function countyLookup(args: {
  county: string;
  state: string | null;
  lines: Array<{ key: string; identifiers: PrintedIdentifier[] }>;
}): Promise<CountyLookupResponse> {
  // Chunked so a big first-year batch never exceeds the route's line
  // cap (which would silently drop lines); a network failure on any
  // chunk is reported as an error, never thrown at the caller.
  const out: CountyLookupResponse = { service: null, results: [] };
  for (let i = 0; i < args.lines.length; i += LOOKUP_CHUNK) {
    const chunk = args.lines.slice(i, i + LOOKUP_CHUNK);
    let res: Response;
    try {
      res = await fetch("/api/gis/identifier-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          county: args.county,
          state: args.state,
          lines: chunk.map((l) => ({ key: l.key, identifiers: l.identifiers.map((i) => ({ kind: i.kind, value: i.value, label: i.label })) })),
        }),
      });
    } catch (err) {
      return { ...out, error: err instanceof Error && err.message ? err.message : "could not reach the server" };
    }
    const body = (await res.json().catch(() => ({}))) as Partial<CountyLookupResponse>;
    out.service = body.service ?? out.service;
    if (!res.ok) return { ...out, error: String(body.error ?? `County lookup failed (${res.status})`) };
    if (body.reason) return { ...out, reason: body.reason };
    out.results.push(...(Array.isArray(body.results) ? body.results : []));
  }
  return out;
}

// The county import page, seeded to that parcel with the search already
// run (the same link the map's Neighbors overlay uses).
export function importParcelHref(serviceId: string, parcelNumber: string): string {
  return `/import/county?service=${encodeURIComponent(serviceId)}&mode=parcel&q=${encodeURIComponent(parcelNumber)}&run=1`;
}
