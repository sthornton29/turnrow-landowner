"use client";

// The self-learning writes behind every confirmation, shared by the
// upload review and the Property Taxes page's line-level resolve:
//   confirmLineParcel   link a line to a parcel and remember every
//                       identifier printed on that line on the parcel
//   confirmStatementEntity  link a statement to an entity, register the
//                       county + account to it, and save the printed
//                       taxpayer spelling as an alias when new
// Nothing here runs without a user confirmation upstream.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeOwnerName } from "@/lib/ownerNames";
import { normalizeIdentifier, type PrintedIdentifier, type StoredIdentifier } from "@/lib/taxIdentifiers";
import { aliasToLearn, identifiersToLearn, type MatchableEntityRef } from "@/lib/taxMatch";

export async function loadStoredIdentifiers(supabase: SupabaseClient): Promise<StoredIdentifier[]> {
  const { data } = await supabase.from("parcel_identifiers").select("parcel_id, kind, value, normalized");
  return ((data ?? []) as StoredIdentifier[]).map((r) => ({ ...r }));
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
  const stored = args.stored ?? (await loadStoredIdentifiers(supabase));
  const learned = identifiersToLearn(args.parcelId, args.identifiers, stored);
  if (learned.length === 0) return null;
  const now = new Date().toISOString();
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
  return idErr ? idErr.message : null;
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
