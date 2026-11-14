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
  detailsLostOnTypeChange,
} from "@/lib/assetTypes";
import { friendlyDbError, NO_ACCESS_MESSAGE } from "@/lib/dbErrors";
import EntityDocuments from "@/components/documents/EntityDocuments";
import { circleUpdateForDetails } from "@/lib/geo/circle";
import { formatNumber } from "@/lib/format";
import type { AssetGeo, AssetType } from "@/types/db";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";

// Full asset editor: shared fields plus the dynamic type-specific form
// driven by lib/assetTypes.ts, photos, and documents. Grain bins lead
// with capacity; bin sites lead with the TOTAL capacity of their bins.
export default function AssetDetail({
  asset,
  properties,
  parentOptions,
  childAssets,
  orgId,
}: {
  asset: AssetGeo;
  properties: Array<{ id: string; name: string }>;
  parentOptions: Array<{ id: string; name: string }>;
  childAssets: Array<{
    id: string;
    name: string;
    asset_type: string;
    details: Record<string, unknown> | null;
    is_active: boolean;
  }>;
  orgId: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [assetType, setAssetType] = useState<AssetType>(asset.asset_type);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Deactivate, reactivate, and delete report beside their own buttons.
  const [actionError, setActionError] = useState<string | null>(null);

  const def = ASSET_TYPES[assetType];

  // Capacity is the grain headline: a bin's own bushels, a site's total
  // over its active bins.
  const capacityBu = Number(asset.details?.capacity_bu) || null;
  const isSite = assetType === "grain_bin_site";
  const childBins = childAssets.filter(
    (c) => c.asset_type === "grain_bin" && c.is_active
  );
  const siteCapacity = childBins.reduce(
    (s, b) => s + (Number(b.details?.capacity_bu) || 0),
    0
  );
  const parentName = asset.parent_asset_id
    ? parentOptions.find((p) => p.id === asset.parent_asset_id)?.name ?? null
    : null;

  // A new bin lands on the site unplaced (no geometry yet); the map's
  // Move pin puts it on the ground afterward.
  async function addBinToSite() {
    const name = window.prompt("Name the new bin (e.g. Bin 3)");
    if (!name?.trim()) return;
    setBusy(true);
    const { data, error: err } = await supabase
      .from("assets")
      .insert({
        organization_id: orgId,
        asset_type: "grain_bin",
        name: name.trim(),
        property_id: asset.property_id,
        parent_asset_id: asset.id,
      })
      .select("id")
      .single();
    setBusy(false);
    if (err || !data) {
      setError(friendlyDbError(err, "Could not add the bin. Please try again."));
      return;
    }
    router.push(`/assets/${data.id}`);
  }

  async function save(formData: FormData) {
    setError(null);
    setMessage(null);

    // A new Type keeps only its own details. Say what the old type's
    // saved details are before they go, and let the person back out.
    const lost = detailsLostOnTypeChange(asset.asset_type, assetType, asset.details);
    if (
      lost.length > 0 &&
      !window.confirm(
        [
          `Changing the type from ${ASSET_TYPES[asset.asset_type].label} to ${def.label} removes these saved details:`,
          lost.join(", "),
          "Save anyway?",
        ].join("\n\n")
      )
    ) {
      return;
    }
    setBusy(true);

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
        parent_asset_id: def.parentType ? text("parent_asset_id") : null,
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
      setError(friendlyDbError(err ?? gErr, "Could not save. Please try again."));
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  async function setActive(active: boolean) {
    setBusy(true);
    setActionError(null);
    // Asking for the row back tells a refusal apart from a success: row
    // level security answers "no" with no error and no row.
    const { data, error: err } = await supabase
      .from("assets")
      .update({ is_active: active })
      .eq("id", asset.id)
      .select("id");
    setBusy(false);
    if (err || (data ?? []).length === 0) {
      setActionError(
        err
          ? friendlyDbError(err, active ? "Could not reactivate this asset. Please try again." : "Could not deactivate this asset. Please try again.")
          : NO_ACCESS_MESSAGE
      );
      return;
    }
    router.refresh();
  }

  // Deleting removes the asset row and its saved details. Photos and
  // documents attached to it are separate records with no link the
  // database follows, so they are NOT deleted: they stay in Documents.
  // Assets that point here as their site or supply well are kept and
  // detached (parent_asset_id is set null by the foreign key).
  async function remove() {
    const attached = childAssets.length;
    const message = [
      `Permanently delete ${asset.name}? Its saved details go with it, and this cannot be undone.`,
      "Photos and documents attached to it are not deleted. They stay in your Documents list; remove them there first if you do not want to keep them.",
      attached > 0
        ? `${formatNumber(attached)} asset${attached === 1 ? "" : "s"} linked to it ${attached === 1 ? "is" : "are"} kept and will no longer point to it.`
        : null,
      "Usually Deactivate is better; it keeps the history.",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!window.confirm(message)) return;
    setBusy(true);
    setActionError(null);
    const { data, error: err } = await supabase.from("assets").delete().eq("id", asset.id).select("id");
    if (err || (data ?? []).length === 0) {
      setBusy(false);
      setActionError(err ? friendlyDbError(err, "Could not delete this asset. Please try again.") : NO_ACCESS_MESSAGE);
      return;
    }
    router.push("/assets");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
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

      {/* Capacity headline: a bin's bushels, or a site's total. */}
      {isSite ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Total capacity
          </p>
          <p className="text-3xl font-semibold text-pine-900">
            {formatNumber(siteCapacity)} <span className="text-lg font-medium">bu</span>
          </p>
          <p className="mt-0.5 text-sm text-gray-600">
            {childBins.length} bin{childBins.length === 1 ? "" : "s"} on this site
          </p>
          {childBins.length > 0 ? (
            <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
              {childBins.map((b) => (
                <li key={b.id} className="flex items-baseline justify-between py-1.5 text-sm">
                  <Link href={`/assets/${b.id}`} className="font-medium text-gray-900 hover:underline">
                    {b.name}
                  </Link>
                  <span className="text-pine-900">
                    {Number(b.details?.capacity_bu)
                      ? `${formatNumber(Number(b.details?.capacity_bu))} bu`
                      : "no capacity set"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            onClick={addBinToSite}
            disabled={busy}
            className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            + Add a bin to this site
          </button>
        </div>
      ) : assetType === "grain_bin" ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Capacity
          </p>
          <p className="text-3xl font-semibold text-pine-900">
            {capacityBu != null ? formatNumber(capacityBu) : "-"}{" "}
            <span className="text-lg font-medium">bu</span>
          </p>
          {parentName ? (
            <p className="mt-0.5 text-sm text-gray-600">
              Part of{" "}
              <Link
                href={`/assets/${asset.parent_asset_id}`}
                className="font-medium text-kelly-700 hover:underline"
              >
                {parentName}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        // Submitted by hand rather than through the form's action, so a
        // failed or cancelled save does not reset what was typed.
        onSubmit={(e) => {
          e.preventDefault();
          void save(new FormData(e.currentTarget));
        }}
        className="space-y-4 rounded-xl border border-gray-200 bg-white p-4"
      >
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
          {def.parentType ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {def.parentLabel ?? "Parent"}
              </label>
              <select
                name="parent_asset_id"
                defaultValue={asset.parent_asset_id ?? ""}
                className={inputClass}
              >
                <option value="">None</option>
                {parentOptions.map((w) => (
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
        {actionError ? <p className="basis-full text-sm text-red-600">{actionError}</p> : null}
      </section>
    </div>
  );
}
