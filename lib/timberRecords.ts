// Loads stand activities (migration 0045) with the stands each covers
// and its costs, for the stand and Timber pages. Any query error
// (for example the migration not run yet) degrades to "no history"
// rather than breaking the page.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StandActivityRow, TimberCostRow } from "@/types/db";

export interface LoadedActivity extends StandActivityRow {
  standIds: string[];
  costs: TimberCostRow[];
}

export async function loadStandActivities(
  supabase: SupabaseClient,
  standIds?: string[]
): Promise<LoadedActivity[]> {
  let linkQuery = supabase.from("stand_activity_stands").select("activity_id, timber_stand_id");
  if (standIds) linkQuery = linkQuery.in("timber_stand_id", standIds);
  const { data: links, error: linkErr } = await linkQuery;
  if (linkErr || !links || links.length === 0) return [];
  const activityIds = Array.from(new Set(links.map((l) => l.activity_id as string)));

  const [{ data: acts, error: actErr }, { data: allLinks }, { data: costs }] = await Promise.all([
    supabase.from("stand_activities").select("*").in("id", activityIds),
    // Every stand of these activities, not just the filtered ones, so a
    // stand page can say "also covers ...".
    supabase
      .from("stand_activity_stands")
      .select("activity_id, timber_stand_id")
      .in("activity_id", activityIds),
    supabase.from("timber_costs").select("*").in("activity_id", activityIds),
  ]);
  if (actErr || !acts) return [];

  const standsByAct = new Map<string, string[]>();
  for (const l of allLinks ?? links) {
    const id = l.activity_id as string;
    standsByAct.set(id, [...(standsByAct.get(id) ?? []), l.timber_stand_id as string]);
  }
  const costsByAct = new Map<string, TimberCostRow[]>();
  for (const c of (costs ?? []) as TimberCostRow[]) {
    if (!c.activity_id) continue;
    costsByAct.set(c.activity_id, [...(costsByAct.get(c.activity_id) ?? []), c]);
  }
  return (acts as StandActivityRow[]).map((a) => ({
    ...a,
    standIds: standsByAct.get(a.id) ?? [],
    costs: (costsByAct.get(a.id) ?? []).sort((x, y) => x.paid_date.localeCompare(y.paid_date)),
  }));
}

export function activitiesForStand(all: LoadedActivity[], standId: string): LoadedActivity[] {
  return all.filter((a) => a.standIds.includes(standId));
}
