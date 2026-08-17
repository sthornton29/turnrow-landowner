// Server-side sync engine for farm connections. Pulls fields, plantings,
// harvest status, and yields (when scoped) from the partner API and upserts
// local snapshots. Never deletes prior data; the app runs fully from local
// snapshots when the farm API is slow or down.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

import { decryptSecret } from "@/lib/farmCrypto";
import {
  FarmApiError,
  getFields,
  getHandshake,
  getMarketingPrices,
  getPlantings,
  getProduction,
  getProjectedYields,
} from "@/lib/farmApi";
import { suggestLocalField } from "@/lib/farmDisplay";

interface ConnectionRow {
  id: string;
  organization_id: string;
  api_key_encrypted: string;
  status: string;
}

export interface SyncResult {
  connectionId: string;
  ok: boolean;
  error?: string;
  fields?: number;
  plantings?: number;
}

// Refresh the mapping snapshot rows for a connection: insert any new remote
// fields (with a best-effort local suggestion) and update name/acres
// snapshots on existing rows. Existing mapping statuses are never changed.
export async function refreshMappings(
  supabase: AnyClient,
  connection: { id: string; organization_id: string },
  token: string
): Promise<number> {
  const remoteFields = await getFields(token);
  const [{ data: existing }, { data: localFields }] = await Promise.all([
    supabase
      .from("field_mappings")
      .select("id, remote_field_id")
      .eq("farm_connection_id", connection.id),
    supabase
      .from("fields")
      .select("id, name, acres")
      .eq("organization_id", connection.organization_id),
  ]);
  const known = new Map(
    ((existing ?? []) as Array<{ id: string; remote_field_id: string }>).map((m) => [
      m.remote_field_id,
      m.id,
    ])
  );

  for (const remote of remoteFields) {
    const snapshot = {
      remote_name: remote.name,
      remote_farm: remote.farm_name,
      remote_acres: remote.acres?.total ?? null,
    };
    const existingId = known.get(remote.id);
    if (existingId) {
      await supabase.from("field_mappings").update(snapshot).eq("id", existingId);
    } else {
      const suggestion = suggestLocalField(
        { name: remote.name, acres: remote.acres?.total ?? null },
        (localFields ?? []) as Array<{ id: string; name: string; acres: number | null }>
      );
      await supabase.from("field_mappings").insert({
        organization_id: connection.organization_id,
        farm_connection_id: connection.id,
        remote_field_id: remote.id,
        ...snapshot,
        local_field_id: suggestion?.id ?? null,
        status: "suggested",
      });
    }
  }
  return remoteFields.length;
}

export async function syncConnection(
  supabase: AnyClient,
  connection: ConnectionRow
): Promise<SyncResult> {
  const year = new Date().getFullYear();
  try {
    const token = decryptSecret(connection.api_key_encrypted);
    const handshake = await getHandshake(token);

    const fieldCount = await refreshMappings(supabase, connection, token);

    const [plantings, production] = await Promise.all([
      getPlantings(token, year),
      getProduction(token, year).catch((err) => {
        // Harvest/production may legitimately be unavailable; plantings
        // alone still sync. Revocation must still surface.
        if (err instanceof FarmApiError && err.isRevoked) throw err;
        return [];
      }),
    ]);

    const productionByKey = new Map(
      production.map((p) => [`${p.field_id}|${(p.crop ?? "").toLowerCase()}`, p])
    );

    for (const planting of plantings) {
      const crop = planting.crop ?? "";
      const prod = productionByKey.get(`${planting.field_id}|${crop.toLowerCase()}`);
      await supabase.from("farm_field_data").upsert(
        {
          organization_id: connection.organization_id,
          farm_connection_id: connection.id,
          remote_field_id: planting.field_id,
          crop_year: year,
          crop,
          planted_acres: planting.planted_acres ?? null,
          planting_date: planting.planting_date ?? null,
          varieties: planting.varieties ?? [],
          harvested_acres: prod?.harvested_acres ?? null,
          production_units: prod?.production_units ?? null,
          production_unit: prod?.unit ?? null,
          yield_shared: Boolean(handshake.scopes?.yields),
          payload: { planting, production: prod ?? null },
          synced_at: new Date().toISOString(),
        },
        { onConflict: "farm_connection_id,remote_field_id,crop_year,crop" }
      );
    }

    // Tenant projected prices and yields, when the farmer has those
    // scopes on. Scope-off responses are quiet non-events; revocation
    // still surfaces. Cached locally so the app keeps working when the
    // farm software is unreachable.
    if (handshake.scopes?.projected_prices) {
      try {
        const prices = await getMarketingPrices(token, year);
        for (const price of prices) {
          await supabase.from("farm_marketing_prices").upsert(
            {
              organization_id: connection.organization_id,
              farm_connection_id: connection.id,
              crop_year: price.crop_year,
              crop: price.crop ?? "",
              projected_avg_price: price.projected_avg_price,
              unit: price.unit,
              is_final: Boolean(price.is_final),
              as_of: price.as_of ?? null,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "farm_connection_id,crop_year,crop" }
          );
        }
      } catch (err) {
        if (err instanceof FarmApiError && err.isRevoked) throw err;
        // Prices alone failing never fails the sync.
      }
    }
    if (handshake.scopes?.projected_yields) {
      try {
        const projectedYields = await getProjectedYields(token, year);
        for (const row of projectedYields) {
          await supabase.from("farm_projected_yields").upsert(
            {
              organization_id: connection.organization_id,
              farm_connection_id: connection.id,
              remote_field_id: row.field_id,
              crop_year: row.crop_year,
              crop: row.crop ?? "",
              planted_acres: row.planted_acres,
              yield_per_acre: row.yield_per_acre,
              unit: row.unit,
              basis: row.basis,
              practices: row.practices,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "farm_connection_id,remote_field_id,crop_year,crop" }
          );
        }
      } catch (err) {
        if (err instanceof FarmApiError && err.isRevoked) throw err;
      }
    }

    await supabase
      .from("farm_connections")
      .update({
        status: "active",
        scopes: handshake.scopes,
        operation_name: handshake.operation_name,
        landowner_name: handshake.landowner_name,
        field_count: handshake.field_count,
        last_synced_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", connection.id);

    return { connectionId: connection.id, ok: true, fields: fieldCount, plantings: plantings.length };
  } catch (err) {
    const revoked = err instanceof FarmApiError && err.isRevoked;
    const message =
      err instanceof Error ? err.message : "Sync failed for an unknown reason.";
    await supabase
      .from("farm_connections")
      .update({
        status: revoked ? "revoked" : "error",
        last_error: revoked ? "Your farmer has ended or changed this share." : message,
      })
      .eq("id", connection.id);
    return { connectionId: connection.id, ok: false, error: message };
  }
}
