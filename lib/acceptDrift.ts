// Accepting a tenant-data drift flag: one tap rewrites the committed
// assumption value and its provenance tag exactly the way a Use fill
// plus Save would, then removes the flag. The drift row itself IS the
// review (old and new value side by side), so accepting saves
// immediately; nothing here ever runs without that explicit tap.
// A flag whose committed value moved since detection is stale: it is
// dropped without writing anything.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

import { matchCrop } from "@/lib/crops";
import { DRIFT_EPSILON, type DriftField } from "@/lib/assumptionDrift";
import {
  cropAssumptions,
  normalizeCropEntries,
  type CropAssumption,
  type ValueSourceKind,
  type YearAssumptions,
} from "@/lib/leaseLogic";

export interface DriftRow {
  id: string;
  lease_id: string;
  year: number;
  crop: string;
  practice: "irrigated" | "dryland" | "blended";
  field: DriftField;
  committed_value: number;
  tenant_value: number;
  tenant_kind: ValueSourceKind;
  tenant_as_of: string | null;
  is_final_price: boolean;
}

export async function acceptDriftRow(
  supabase: AnyClient,
  drift: DriftRow
): Promise<{ accepted: boolean; error: string | null }> {
  const { data: row, error: readError } = await supabase
    .from("lease_year_assumptions")
    .select("id, data")
    .eq("lease_id", drift.lease_id)
    .eq("year", drift.year)
    .maybeSingle();
  if (readError) return { accepted: false, error: readError.message };
  if (!row) {
    // The assumption row is gone; the flag has nothing to update.
    await supabase.from("lease_assumption_drift").delete().eq("id", drift.id);
    return { accepted: false, error: null };
  }

  const data = (row.data ?? {}) as YearAssumptions;
  const entries = cropAssumptions(data).map((e) => ({ ...e, sources: { ...(e.sources ?? {}) } }));
  const crops = entries.map((e) => e.crop ?? null);
  const match = matchCrop(drift.crop, crops);
  const entry: CropAssumption | undefined = entries.find(
    (e) => e.crop === match && (e.practice ?? "blended") === drift.practice
  );
  const committed = entry?.[drift.field];
  if (
    !entry ||
    committed == null ||
    Math.abs(committed - drift.committed_value) > DRIFT_EPSILON
  ) {
    // Stale flag: the entry vanished or the value moved after detection.
    await supabase.from("lease_assumption_drift").delete().eq("id", drift.id);
    return { accepted: false, error: null };
  }

  entry[drift.field] = drift.tenant_value;
  entry.sources = {
    ...(entry.sources ?? {}),
    [drift.field]: { kind: drift.tenant_kind, as_of: drift.tenant_as_of },
  };

  const next: YearAssumptions = {
    ...(data.bonus_estimate != null ? { bonus_estimate: data.bonus_estimate } : {}),
    crops: normalizeCropEntries(entries),
  };
  const { error: writeError } = await supabase
    .from("lease_year_assumptions")
    .update({ data: next })
    .eq("id", row.id);
  if (writeError) return { accepted: false, error: writeError.message };

  const { error: clearError } = await supabase
    .from("lease_assumption_drift")
    .delete()
    .eq("id", drift.id);
  if (clearError) return { accepted: false, error: clearError.message };
  return { accepted: true, error: null };
}

// Bulk accept = the same primitive, one explicit press over an
// explicitly listed set. Sequential so two rows on the same lease-year
// never race each other's read-modify-write.
export async function acceptDriftRows(
  supabase: AnyClient,
  drifts: DriftRow[]
): Promise<{ accepted: number; error: string | null }> {
  let accepted = 0;
  for (const drift of drifts) {
    const result = await acceptDriftRow(supabase, drift);
    if (result.error) return { accepted, error: result.error };
    if (result.accepted) accepted++;
  }
  return { accepted, error: null };
}
