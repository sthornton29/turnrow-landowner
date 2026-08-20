"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ASSET_TYPES,
  ASSET_TYPE_ORDER,
  CONDITION_LABELS,
  cleanDetails,
} from "@/lib/assetTypes";
import EntityDocuments from "@/components/documents/EntityDocuments";
import { circleUpdateForDetails } from "@/lib/geo/circle";
import type { AssetGeo, AssetType } from "@/types/db";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";

// Full asset editor: shared fields plus the dynamic type-specific form
// driven by lib/assetTypes.ts, photos, and documents.
export default function AssetDetail({
  asset,
  properties,
  wells,
  orgId,
}: {
  asset: AssetGeo;
  properties: Array<{ id: string; name: string }>;
  wells: Array<{ id: string; name: string }>;
  orgId: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [assetType, setAssetType] = useState<AssetType>(asset.asset_type);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const def = ASSET_TYPES[assetType];

  async function save(formData: FormData) {
    setBusy(true);
    setError(null);
    setMessage(null);

    const raw = Object.fromEntries(formData.entries());
    const num = (key: string) => {
      const s = String(raw[key] ?? "").trim();
      return s === "" ? null : Number(s);
    };
    const text = (key: string) => String(raw[key] ?? "").trim() || null;

    const details = cleanDetails(
      assetType,
      raw as Record<string, FormDataEntryValue>,
      asset.details ?? {}
    );
    const { error: err } = await supabase
      .from("assets")
      .update({
        name: String(raw.name ?? "").trim(),
        asset_type: assetType,
        property_id: text("property_id"),
        year_installed: num("year_installed"),
        condition: text("condition"),
        estimated_value: num("estimated_value"),
        parent_asset_id: def.canLinkToWell ? text("parent_asset_id") : null,
        notes: text("notes"),
        details,
      })
      .eq("id", asset.id);

    // Circle footprints sync two ways: a new diameter typed here
    // regenerates the map polygon (the circle editor writes the same
    // diameter_ft when dragged).
    const circle = err ? null : circleUpdateForDetails(asset.details ?? {}, details);
    const gErr = circle
      ? (
          await supabase.rpc("set_geometry", {
            p_entity_type: "asset",
            p_entity_id: asset.id,
            p_geojson: circle.polygon,
          })
        ).error
      : null;

    setBusy(false);
    if (err || gErr) {
      setError("Could not save. " + (err?.message ?? gErr?.message ?? ""));
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  async function setActive(active: boolean) {
    setBusy(true);
    await supabase.from("assets").update({ is_active: active }).eq("id", asset.id);
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (
      !window.confirm(
        "Permanently delete this asset and its records? Usually Deactivate is better; it keeps the history."
      )
    ) {
      return;
    }
    await supabase.from("assets").delete().eq("id", asset.id);
    router.push("/assets");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <Link href="/assets" className="text-sm text-gray-500 hover:underline">
          &larr; Assets
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-pine-900 text-sm font-bold text-white">
            {def.letter}
          </span>
          <h1 className="text-2xl font-semibold text-gray-900">{asset.name}</h1>
          {!asset.is_active ? (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              Inactive
            </span>
          ) : null}
          {asset.geom_geojson ? (
            <Link
              href={`/map?focus=asset:${asset.id}`}
              className="ml-auto rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600"
            >
              Show on map
            </Link>
          ) : (
            <span className="ml-auto text-sm text-gray-500">
              No location yet; place it from the map page.
            </span>
          )}
        </div>
      </div>

      <form action={save} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input name="name" defaultValue={asset.name} required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
            <select
              value={assetType}
              onChange={(e) => setAssetType(e.target.value as AssetType)}
              className={inputClass}
            >
              {ASSET_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPES[t].label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Property</label>
            <select
              name="property_id"
              defaultValue={asset.property_id ?? ""}
              className={inputClass}
            >
              <option value="">None</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Year installed / built
            </label>
            <input
              name="year_installed"
              type="number"
              defaultValue={asset.year_installed ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Condition</label>
            <select
              name="condition"
              defaultValue={asset.condition ?? ""}
              className={inputClass}
            >
              <option value="">Not set</option>
              {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Estimated value ($)
            </label>
            <input
              name="estimated_value"
              type="number"
              step="0.01"
              defaultValue={asset.estimated_value ?? ""}
              className={inputClass}
            />
          </div>
          {def.canLinkToWell ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Supply well
              </label>
              <select
                name="parent_asset_id"
                defaultValue={asset.parent_asset_id ?? ""}
                className={inputClass}
              >
                <option value="">None</option>
                {wells.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {def.fields.length > 0 ? (
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              {def.label} details
            </h2>
            {asset.asset_type === "irrigation_pivot" &&
            asset.details?.center_lon != null ? (
              <p className="mb-2 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
                This pivot has a coverage circle; its center, radius, and sweep
                are edited on the map (open the pivot there and choose Edit
                coverage circle).
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {def.fields
                .filter((f) => !f.mapManaged)
                .map((f) => (
                <div key={f.key} className={f.input === "boolean" ? "flex items-end" : ""}>
                  {f.input === "boolean" ? (
                    <label className="flex items-center gap-2 pb-2 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        name={f.key}
                        defaultChecked={asset.details?.[f.key] === true}
                        className="h-4 w-4 accent-kelly-500"
                      />
                      {f.label}
                    </label>
                  ) : (
                    <>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        {f.label}
                        {f.unit ? ` (${f.unit})` : ""}
                      </label>
                      {f.input === "select" ? (
                        <select
                          name={f.key}
                          defaultValue={String(asset.details?.[f.key] ?? "")}
                          className={inputClass}
                        >
                          <option value="">Not set</option>
                          {f.options?.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          name={f.key}
                          type={f.input === "number" ? "number" : "text"}
                          step={f.input === "number" ? "any" : undefined}
                          defaultValue={String(asset.details?.[f.key] ?? "")}
                          className={inputClass}
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
          <textarea
            name="notes"
            rows={3}
            defaultValue={asset.notes ?? ""}
            className={inputClass}
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm text-kelly-700">{message}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save changes"}
        </button>
      </form>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Photos and documents
        </h2>
        <EntityDocuments orgId={orgId} entityType="asset" entityId={asset.id} />
      </section>

      <section className="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
        {asset.is_active ? (
          <button
            onClick={() => setActive(false)}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Deactivate (removed / demolished)
          </button>
        ) : (
          <button
            onClick={() => setActive(true)}
            disabled={busy}
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            Reactivate
          </button>
        )}
        <button
          onClick={remove}
          disabled={busy}
          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Delete permanently
        </button>
      </section>
    </div>
  );
}
