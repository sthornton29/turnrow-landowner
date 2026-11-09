"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchableEntity, MatchableParcel, MatchableProperty } from "@/lib/documentMatch";
import type { IntakeContext } from "../classify";

export interface MatchingContext {
  loaded: boolean;
  properties: MatchableProperty[];
  propertyEntity: Record<string, string | null>;
  parcels: MatchableParcel[];
  entities: MatchableEntity[];
}

// What the intake matches documents against, loaded once per flow:
// properties with their aliases, parcels, and entities with confirmed
// aliases. Session client, so RLS scopes every read to the org.
export function useMatchingContext(supabase: SupabaseClient): MatchingContext {
  const [ctx, setCtx] = useState<MatchingContext>({
    loaded: false,
    properties: [],
    propertyEntity: {},
    parcels: [],
    entities: [],
  });

  // Warm the land index (migration 0029) so the spatial tier matches by
  // table lookup; idempotent and cheap when nothing changed.
  useEffect(() => {
    fetch("/api/land-index", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }).catch(
      () => undefined
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, pc, e, a, pa] = await Promise.all([
        supabase.from("properties").select("id, name, county, state, fsa_numbers, acres, entity_id").order("name"),
        supabase.from("parcels").select("id, property_id, parcel_number"),
        supabase.from("entities").select("id, name").order("name"),
        supabase.from("entity_aliases").select("entity_id, alias"),
        supabase.from("property_aliases").select("property_id, alias"),
      ]);
      if (cancelled) return;
      const props = (p.data ?? []) as Array<{
        id: string;
        name: string;
        county: string | null;
        state: string | null;
        fsa_numbers: string[] | null;
        acres: number | string | null;
        entity_id: string | null;
      }>;
      const propAliases = new Map<string, string[]>();
      for (const row of (pa.data ?? []) as Array<{ property_id: string; alias: string }>) {
        propAliases.set(row.property_id, [...(propAliases.get(row.property_id) ?? []), row.alias]);
      }
      const aliasesBy = new Map<string, string[]>();
      for (const row of (a.data ?? []) as Array<{ entity_id: string; alias: string }>) {
        aliasesBy.set(row.entity_id, [...(aliasesBy.get(row.entity_id) ?? []), row.alias]);
      }
      setCtx({
        loaded: true,
        properties: props.map((x) => ({
          id: x.id,
          name: x.name,
          county: x.county,
          state: x.state,
          fsa_numbers: x.fsa_numbers ?? null,
          acres: x.acres === null || x.acres === undefined ? null : Number(x.acres),
          aliases: propAliases.get(x.id) ?? [],
        })),
        propertyEntity: Object.fromEntries(props.map((x) => [x.id, x.entity_id ?? null])),
        parcels: ((pc.data ?? []) as MatchableParcel[]).map((x) => ({
          id: x.id,
          property_id: x.property_id,
          parcel_number: x.parcel_number,
        })),
        entities: ((e.data ?? []) as Array<{ id: string; name: string }>).map((x) => ({
          id: x.id,
          name: x.name,
          aliases: aliasesBy.get(x.id) ?? [],
        })),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return ctx;
}

// The context the intake AI call carries (property names, parcels, FSA
// numbers, aliases, entities).
export function intakeContextFrom(ctx: MatchingContext): IntakeContext {
  return {
    properties: ctx.properties.map((p) => ({
      name: p.name,
      county: p.county,
      state: p.state,
      parcel_numbers: ctx.parcels.filter((pc) => pc.property_id === p.id).map((pc) => pc.parcel_number),
      fsa_numbers: p.fsa_numbers ?? [],
      acres: p.acres,
      aliases: p.aliases ?? [],
    })),
    entities: ctx.entities.map((e) => ({ name: e.name, aliases: e.aliases })),
  };
}
