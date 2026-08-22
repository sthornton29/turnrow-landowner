import { requireOrg } from "@/lib/auth";
import TaxUploadClient from "./TaxUploadClient";

export const metadata = { title: "Upload tax statements" };

// Everything the review needs to match lines and headers before anything
// is saved: parcels with their property names, entities with the
// spellings counties have used for them, the account registry, and the
// identifier store (migration 0030). Session client; RLS scopes it.
export default async function TaxUploadPage() {
  const { supabase, profile } = await requireOrg();

  const [parcels, properties, entities, aliases, accounts, identifiers, defaults] = await Promise.all([
    supabase.from("parcels").select("id, parcel_number, county, property_id").order("parcel_number"),
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("entity_aliases").select("entity_id, alias"),
    supabase.from("entity_accounts").select("county, state, account_number, entity_id"),
    supabase.from("parcel_identifiers").select("parcel_id, kind, value, normalized"),
    supabase.from("county_tax_defaults").select("*"),
  ]);

  const propertyName = new Map((properties.data ?? []).map((p) => [p.id, p.name]));
  const entityName = new Map((entities.data ?? []).map((e) => [e.id, e.name]));
  const aliasesBy = new Map<string, string[]>();
  for (const a of aliases.data ?? []) aliasesBy.set(a.entity_id, [...(aliasesBy.get(a.entity_id) ?? []), a.alias]);

  return (
    <TaxUploadClient
      orgId={profile.organization_id!}
      parcels={(parcels.data ?? []).map((p) => ({
        id: p.id,
        parcel_number: p.parcel_number,
        county: p.county,
        property_id: p.property_id,
        property_name: propertyName.get(p.property_id) ?? null,
      }))}
      properties={(properties.data ?? []).map((p) => ({ id: p.id, name: p.name, entity_id: p.entity_id ?? null }))}
      entities={(entities.data ?? []).map((e) => ({ id: e.id, name: e.name, aliases: aliasesBy.get(e.id) ?? [] }))}
      accounts={(accounts.data ?? []).map((a) => ({
        county: a.county,
        state: a.state,
        account_number: a.account_number,
        entity_id: a.entity_id,
        entity_name: entityName.get(a.entity_id) ?? "Entity",
      }))}
      storedIdentifiers={(identifiers.data ?? []) as Array<{ parcel_id: string; kind: string; value: string; normalized: string }>}
      countyDefaults={defaults.data ?? []}
    />
  );
}
