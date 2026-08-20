"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CountyGisService, LayerField } from "@/lib/gis";

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

const STATUS_CLASSES: Record<string, string> = {
  active: "bg-kelly-50 text-pine-900",
  broken: "bg-red-50 text-red-700",
  untested: "bg-gray-100 text-gray-600",
};

interface LayerInfo {
  service_url: string;
  layer_id: number;
  name: string;
  max_record_count: number;
  fields: LayerField[];
  guesses: { parcel: string | null; owner: string | null; acres: string | null; situs: string | null };
}

interface Sample {
  parcel_number: string;
  owner_name: string;
  deeded_acres: number | null;
  situs: string | null;
  has_geometry: boolean;
}

// Platform admin registry of county ArcGIS parcel services. Rendered
// inside the Settings page's Admin section (embedded) or standalone.
export default function AdminGisClient({
  initialServices,
  embedded = false,
}: {
  initialServices: CountyGisService[];
  embedded?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [services, setServices] = useState(initialServices);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [pasteUrl, setPasteUrl] = useState("");
  const [layerInfo, setLayerInfo] = useState<LayerInfo | null>(null);
  const [form, setForm] = useState({
    state: "AL",
    county: "",
    display_name: "",
    parcel_field: "",
    owner_field: "",
    acres_field: "",
    situs_field: "",
    notes: "",
  });
  const [sample, setSample] = useState<Sample | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from("county_gis_services")
      .select("*")
      .order("state")
      .order("county");
    setServices((data as CountyGisService[]) ?? []);
  }, [supabase]);

  function resetForm() {
    setEditingId(null);
    setPasteUrl("");
    setLayerInfo(null);
    setSample(null);
    setError(null);
    setForm({
      state: "AL",
      county: "",
      display_name: "",
      parcel_field: "",
      owner_field: "",
      acres_field: "",
      situs_field: "",
      notes: "",
    });
  }

  async function fetchLayer(urlOverride?: string) {
    setBusy("layer");
    setError(null);
    setSample(null);
    try {
      const res = await fetch("/api/gis/layer-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlOverride ?? pasteUrl }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not read the layer.");
      const info = body as LayerInfo;
      setLayerInfo(info);
      setForm((f) => ({
        ...f,
        parcel_field: f.parcel_field || info.guesses.parcel || "",
        owner_field: f.owner_field || info.guesses.owner || "",
        acres_field: f.acres_field || info.guesses.acres || "",
        situs_field: f.situs_field || info.guesses.situs || "",
        display_name: f.display_name || info.name,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the layer.");
    } finally {
      setBusy(null);
    }
  }

  async function runTest(): Promise<boolean> {
    if (!layerInfo) return false;
    setBusy("test");
    setError(null);
    try {
      const res = await fetch("/api/gis/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_url: layerInfo.service_url,
          layer_id: layerInfo.layer_id,
          parcel_field: form.parcel_field,
          owner_field: form.owner_field,
          acres_field: form.acres_field || null,
          situs_field: form.situs_field || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Test query failed.");
      setSample(body.sample as Sample);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test query failed.");
      setSample(null);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!layerInfo) return;
    if (!form.state.trim() || !form.county.trim() || !form.parcel_field || !form.owner_field) {
      setError("State, county, parcel field, and owner field are required.");
      return;
    }
    setBusy("save");
    const verified = sample !== null;
    const row = {
      state: form.state.trim().toUpperCase(),
      county: form.county.trim(),
      display_name:
        form.display_name.trim() || `${form.county.trim()} County, ${form.state.trim()}`,
      service_url: layerInfo.service_url,
      layer_id: layerInfo.layer_id,
      parcel_field: form.parcel_field,
      owner_field: form.owner_field,
      acres_field: form.acres_field || null,
      situs_field: form.situs_field || null,
      status: verified ? "active" : "untested",
      last_verified_at: verified ? new Date().toISOString() : null,
      notes: form.notes.trim() || null,
    };
    const { error: err } =
      editingId && editingId !== "new"
        ? await supabase.from("county_gis_services").update(row).eq("id", editingId)
        : await supabase.from("county_gis_services").insert(row);
    setBusy(null);
    if (err) {
      setError("Could not save: " + err.message);
      return;
    }
    resetForm();
    reload();
  }

  async function startEdit(s: CountyGisService) {
    setEditingId(s.id);
    setPasteUrl(`${s.service_url}/${s.layer_id}`);
    setForm({
      state: s.state,
      county: s.county,
      display_name: s.display_name,
      parcel_field: s.parcel_field,
      owner_field: s.owner_field,
      acres_field: s.acres_field ?? "",
      situs_field: s.situs_field ?? "",
      notes: s.notes ?? "",
    });
    setSample(null);
    await fetchLayer(`${s.service_url}/${s.layer_id}`);
  }

  async function setStatus(s: CountyGisService, status: CountyGisService["status"]) {
    await supabase.from("county_gis_services").update({ status }).eq("id", s.id);
    reload();
  }

  async function reverify(s: CountyGisService) {
    setRowMessage((m) => ({ ...m, [s.id]: "Verifying..." }));
    try {
      const res = await fetch("/api/gis/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_url: s.service_url,
          layer_id: s.layer_id,
          parcel_field: s.parcel_field,
          owner_field: s.owner_field,
          acres_field: s.acres_field,
          situs_field: s.situs_field,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");
      await supabase
        .from("county_gis_services")
        .update({ status: "active", last_verified_at: new Date().toISOString() })
        .eq("id", s.id);
      setRowMessage((m) => ({
        ...m,
        [s.id]: `OK: parcel ${body.sample.parcel_number}, owner ${body.sample.owner_name}`,
      }));
    } catch (err) {
      await supabase.from("county_gis_services").update({ status: "broken" }).eq("id", s.id);
      setRowMessage((m) => ({
        ...m,
        [s.id]: err instanceof Error ? err.message : "Verification failed.",
      }));
    }
    reload();
  }

  async function remove(s: CountyGisService) {
    if (!window.confirm(`Delete the ${s.display_name} service entry?`)) return;
    await supabase.from("county_gis_services").delete().eq("id", s.id);
    reload();
  }

  return (
    <div className={embedded ? "space-y-5" : "mx-auto max-w-4xl space-y-5 p-4 md:p-6"}>
      <div>
        {embedded ? null : (
          <h1 className="text-xl font-semibold text-gray-900">County GIS services</h1>
        )}
        <p className="mt-0.5 text-sm text-gray-600">
          Platform-level registry of county parcel services. Every
          organization sees active entries on the county import page.
        </p>
      </div>

      {/* Add / edit form */}
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">
          {editingId && editingId !== "new" ? "Edit service" : "Add a service"}
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            placeholder="Paste an ArcGIS REST layer URL (.../FeatureServer/0 or .../MapServer/3)"
            className={`${inputClass} min-w-64 flex-1`}
          />
          <button
            onClick={() => fetchLayer()}
            disabled={busy === "layer" || !pasteUrl.trim()}
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
          >
            {busy === "layer" ? "Reading..." : "Read layer"}
          </button>
        </div>

        {layerInfo ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Layer {'"'}
              {layerInfo.name}
              {'"'} · {layerInfo.fields.length} fields · max {layerInfo.max_record_count}{" "}
              records per query
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <label className="mb-0.5 block text-xs font-medium text-gray-600">State</label>
                <input
                  value={form.state}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-gray-600">County</label>
                <input
                  value={form.county}
                  onChange={(e) => setForm((f) => ({ ...f, county: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-gray-600">
                  Display name
                </label>
                <input
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  className={inputClass}
                />
              </div>
              {(
                [
                  ["parcel_field", "Parcel number field", true],
                  ["owner_field", "Owner field", true],
                  ["acres_field", "Deeded acres field", false],
                  ["situs_field", "Address / situs field", false],
                ] as Array<[keyof typeof form, string, boolean]>
              ).map(([key, label, required]) => (
                <div key={key}>
                  <label className="mb-0.5 block text-xs font-medium text-gray-600">
                    {label}
                    {required ? "" : " (optional)"}
                  </label>
                  <select
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">{required ? "Select..." : "None"}</option>
                    {layerInfo.fields.map((fl) => (
                      <option key={fl.name} value={fl.name}>
                        {fl.name}
                        {fl.alias && fl.alias !== fl.name ? ` (${fl.alias})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-0.5 block text-xs font-medium text-gray-600">Notes</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>

            {sample ? (
              <div className="rounded-lg border border-kelly-100 bg-kelly-50 p-3 text-sm text-pine-900">
                <p className="font-medium">Test record looks good:</p>
                <p>
                  Parcel {sample.parcel_number} · Owner {sample.owner_name}
                  {sample.deeded_acres !== null ? ` · ${sample.deeded_acres} deeded acres` : ""}
                  {sample.situs ? ` · ${sample.situs}` : ""}
                  {sample.has_geometry ? " · geometry present" : " · NO GEOMETRY"}
                </p>
              </div>
            ) : null}

            <div className="flex gap-2">
              <button
                onClick={runTest}
                disabled={busy !== null || !form.parcel_field || !form.owner_field}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {busy === "test" ? "Testing..." : "Run test query"}
              </button>
              <button
                onClick={save}
                disabled={busy !== null}
                className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
              >
                {busy === "save"
                  ? "Saving..."
                  : sample
                    ? "Save as active"
                    : "Save as untested"}
              </button>
              <button onClick={resetForm} className="text-sm text-gray-500 hover:underline">
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </section>

      {/* Registry list */}
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-gray-900">
          Registered services ({services.length})
        </h2>
        {services.map((s) => (
          <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{s.display_name}</span>
              <span className="text-sm text-gray-500">
                {s.county}, {s.state} · layer {s.layer_id}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_CLASSES[s.status]}`}
              >
                {s.status}
              </span>
              {s.last_verified_at ? (
                <span className="text-xs text-gray-400">
                  verified {s.last_verified_at.slice(0, 10)}
                </span>
              ) : null}
              <span className="ml-auto flex gap-3 text-sm">
                <button onClick={() => reverify(s)} className="font-medium text-kelly-700 hover:underline">
                  Re-verify
                </button>
                <button onClick={() => startEdit(s)} className="font-medium text-gray-600 hover:underline">
                  Edit
                </button>
                {s.status === "active" ? (
                  <button
                    onClick={() => setStatus(s, "broken")}
                    className="font-medium text-amber-700 hover:underline"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    onClick={() => setStatus(s, "active")}
                    className="font-medium text-kelly-700 hover:underline"
                  >
                    Activate
                  </button>
                )}
                <button onClick={() => remove(s)} className="font-medium text-red-600 hover:underline">
                  Delete
                </button>
              </span>
            </div>
            <p className="mt-0.5 break-all text-xs text-gray-400">{s.service_url}</p>
            {rowMessage[s.id] ? (
              <p className="mt-1 text-xs text-gray-600">{rowMessage[s.id]}</p>
            ) : null}
          </div>
        ))}
        {services.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No services yet. Paste a county's ArcGIS REST layer URL above.
          </p>
        ) : null}
      </section>
    </div>
  );
}
