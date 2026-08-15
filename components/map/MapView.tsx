"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { GeoJSONSource, MapMouseEvent } from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Feature, FeatureCollection, MultiPolygon } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { createClient } from "@/lib/supabase/client";
import {
  approxAcres,
  bboxOf,
  labelPointOf,
  toMultiPolygon,
} from "@/lib/geo/normalize";
import type { EntityType, FieldGeo, ParcelGeo, PropertyGeo } from "@/types/db";
import LayerToggle from "./LayerToggle";
import FeaturePanel from "./FeaturePanel";
import NewBoundaryDialog, { type NewBoundaryPayload } from "./NewBoundaryDialog";
import type { AnyGeoRow, LayerVisibility, MapMode, SelectedFeature } from "./types";

const KELLY = "#39b54a";
const PINE = "#14532d";

const TABLE: Record<EntityType, string> = {
  property: "properties",
  parcel: "parcels",
  field: "fields",
};

function rowsToFC(
  rows: AnyGeoRow[],
  entityType: EntityType
): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    if (!row.boundary_geojson) continue;
    features.push({
      type: "Feature",
      geometry: row.boundary_geojson,
      properties: {
        id: row.id,
        entityType,
        name:
          entityType === "parcel"
            ? (row as ParcelGeo).parcel_number
            : (row as PropertyGeo | FieldGeo).name,
        acres: row.acres,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function rowsToLabelFC(rows: AnyGeoRow[], entityType: EntityType): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    if (!row.boundary_geojson) continue;
    const pt = labelPointOf(row.boundary_geojson);
    if (!pt) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: pt },
      properties: {
        name:
          entityType === "parcel"
            ? (row as ParcelGeo).parcel_number
            : (row as PropertyGeo | FieldGeo).name,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export default function MapView({ orgId }: { orgId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const [properties, setProperties] = useState<PropertyGeo[]>([]);
  const [parcels, setParcels] = useState<ParcelGeo[]>([]);
  const [fields, setFields] = useState<FieldGeo[]>([]);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<MapMode>("view");
  const modeRef = useRef<MapMode>("view");
  modeRef.current = mode;

  const [selected, setSelected] = useState<SelectedFeature | null>(null);
  const [visibility, setVisibility] = useState<LayerVisibility>({
    property: true,
    parcel: true,
    field: true,
  });
  const [fullscreen, setFullscreen] = useState(false);

  // Draw/save state
  const [pendingGeom, setPendingGeom] = useState<MultiPolygon | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // When editing (or drawing a missing boundary for) an existing record:
  const editTargetRef = useRef<SelectedFeature | null>(null);
  const [editHint, setEditHint] = useState<string | null>(null);
  const didFitRef = useRef(false);

  // ---------------------------------------------------------------- data

  const loadData = useCallback(async () => {
    const [p, pa, f] = await Promise.all([
      supabase.from("properties_geo").select("*").order("name"),
      supabase.from("parcels_geo").select("*").order("parcel_number"),
      supabase.from("fields_geo").select("*").order("name"),
    ]);
    setProperties((p.data as PropertyGeo[]) ?? []);
    setParcels((pa.data as ParcelGeo[]) ?? []);
    setFields((f.data as FieldGeo[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedRow: AnyGeoRow | null = useMemo(() => {
    if (!selected) return null;
    const list: AnyGeoRow[] =
      selected.entityType === "property"
        ? properties
        : selected.entityType === "parcel"
          ? parcels
          : fields;
    return list.find((r) => r.id === selected.id) ?? null;
  }, [selected, properties, parcels, fields]);

  const selectedPropertyName = useMemo(() => {
    if (!selectedRow || !selected || selected.entityType === "property") return null;
    const pid = (selectedRow as ParcelGeo | FieldGeo).property_id;
    return properties.find((p) => p.id === pid)?.name ?? null;
  }, [selected, selectedRow, properties]);

  // ---------------------------------------------------------------- map init

  const clickRef = useRef<(e: MapMouseEvent) => void>(() => {});
  clickRef.current = (e) => {
    const map = mapRef.current;
    if (!map || modeRef.current !== "view") return;
    const layers = ["fields-fill", "parcels-fill", "properties-fill"].filter((l) =>
      map.getLayer(l)
    );
    const hits = map.queryRenderedFeatures(e.point, { layers });
    if (hits.length === 0) {
      setSelected(null);
      return;
    }
    const props = hits[0].properties as { id: string; entityType: EntityType };
    setSelected({ entityType: props.entityType, id: props.id });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-91.0, 33.5],
      zoom: 4,
    });
    mapRef.current = map;

    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "bottom-right"
    );
    map.addControl(
      new mapboxgl.GeolocateControl({ showUserLocation: true }),
      "bottom-right"
    );

    const draw = new MapboxDraw({ displayControlsDefault: false });
    map.addControl(draw);
    drawRef.current = draw;

    map.on("load", () => {
      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      for (const id of [
        "properties",
        "parcels",
        "fields",
        "property-labels",
        "parcel-labels",
        "field-labels",
      ]) {
        map.addSource(id, { type: "geojson", data: empty });
      }

      // Properties: white outline over satellite imagery.
      map.addLayer({
        id: "properties-fill",
        type: "fill",
        source: "properties",
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.05 },
      });
      map.addLayer({
        id: "properties-line",
        type: "line",
        source: "properties",
        paint: { "line-color": "#ffffff", "line-width": 2.5 },
      });

      // Parcels: thin dashed light line.
      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.02 },
      });
      map.addLayer({
        id: "parcels-line",
        type: "line",
        source: "parcels",
        paint: {
          "line-color": "#e5e7eb",
          "line-width": 1.4,
          "line-dasharray": [2, 2],
        },
      });

      // Fields: kelly green, the star of the show.
      map.addLayer({
        id: "fields-fill",
        type: "fill",
        source: "fields",
        paint: { "fill-color": KELLY, "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "fields-line",
        type: "line",
        source: "fields",
        paint: { "line-color": KELLY, "line-width": 2 },
      });

      // Selection highlight (filter is set when a feature is selected).
      for (const src of ["properties", "parcels", "fields"]) {
        map.addLayer({
          id: `${src}-selected`,
          type: "line",
          source: src,
          paint: { "line-color": "#ffffff", "line-width": 4.5 },
          filter: ["==", ["get", "id"], ""],
        });
      }

      map.addLayer({
        id: "property-labels",
        type: "symbol",
        source: "property-labels",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 14,
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": PINE,
          "text-halo-width": 1.4,
        },
      });
      map.addLayer({
        id: "field-labels",
        type: "symbol",
        source: "field-labels",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11.5,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        },
        paint: {
          "text-color": "#eafcee",
          "text-halo-color": PINE,
          "text-halo-width": 1.2,
        },
      });
      map.addLayer({
        id: "parcel-labels",
        type: "symbol",
        source: "parcel-labels",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"],
        },
        paint: {
          "text-color": "#e5e7eb",
          "text-halo-color": "#374151",
          "text-halo-width": 1,
        },
      });

      setMapLoaded(true);
    });

    map.on("click", (e) => clickRef.current(e));
    for (const layer of ["properties-fill", "parcels-fill", "fields-fill"]) {
      map.on("mouseenter", layer, () => {
        if (modeRef.current === "view") map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    map.on("draw.create", (e: { features: Feature[] }) => {
      const mp = toMultiPolygon(e.features[0]?.geometry);
      if (!mp) return;
      if (editTargetRef.current) {
        // Drew a boundary for an existing record that had none: save directly.
        saveEditedRef.current(mp);
      } else {
        setPendingGeom(mp);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- sync data to map

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    (map.getSource("properties") as GeoJSONSource)?.setData(
      rowsToFC(properties, "property")
    );
    (map.getSource("parcels") as GeoJSONSource)?.setData(rowsToFC(parcels, "parcel"));
    (map.getSource("fields") as GeoJSONSource)?.setData(rowsToFC(fields, "field"));
    (map.getSource("property-labels") as GeoJSONSource)?.setData(
      rowsToLabelFC(properties, "property")
    );
    (map.getSource("parcel-labels") as GeoJSONSource)?.setData(
      rowsToLabelFC(parcels, "parcel")
    );
    (map.getSource("field-labels") as GeoJSONSource)?.setData(
      rowsToLabelFC(fields, "field")
    );

    // Fit to everything once, when data first arrives.
    if (!didFitRef.current) {
      const box = bboxOf([
        ...properties.map((r) => r.boundary_geojson),
        ...parcels.map((r) => r.boundary_geojson),
        ...fields.map((r) => r.boundary_geojson),
      ]);
      if (box) {
        map.fitBounds(box, { padding: 60, duration: 0 });
        didFitRef.current = true;
      }
    }
  }, [mapLoaded, properties, parcels, fields]);

  // Layer visibility toggles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const groups: Array<[keyof LayerVisibility, string[]]> = [
      ["property", ["properties-fill", "properties-line", "property-labels"]],
      ["parcel", ["parcels-fill", "parcels-line", "parcel-labels"]],
      ["field", ["fields-fill", "fields-line", "field-labels"]],
    ];
    for (const [key, layers] of groups) {
      for (const layer of layers) {
        if (map.getLayer(layer)) {
          map.setLayoutProperty(
            layer,
            "visibility",
            visibility[key] ? "visible" : "none"
          );
        }
      }
    }
  }, [visibility, mapLoaded]);

  // Selection highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const sel: Record<string, string> = { properties: "", parcels: "", fields: "" };
    if (selected) sel[TABLE[selected.entityType]] = selected.id;
    for (const src of ["properties", "parcels", "fields"]) {
      if (map.getLayer(`${src}-selected`)) {
        map.setFilter(`${src}-selected`, ["==", ["get", "id"], sel[src]]);
      }
    }
  }, [selected, mapLoaded]);

  // Resize after CSS fullscreen toggles.
  useEffect(() => {
    mapRef.current?.resize();
  }, [fullscreen]);

  // ---------------------------------------------------------------- actions

  function startDrawing() {
    const draw = drawRef.current;
    if (!draw) return;
    setSelected(null);
    setSaveError(null);
    editTargetRef.current = null;
    setMode("draw");
    setEditHint("Tap the map to add points. Double tap the last point to finish.");
    draw.deleteAll();
    draw.changeMode("draw_polygon");
  }

  function cancelDrawEdit() {
    drawRef.current?.deleteAll();
    setMode("view");
    setPendingGeom(null);
    setSaveError(null);
    setEditHint(null);
    editTargetRef.current = null;
  }

  function startEditBoundary() {
    const draw = drawRef.current;
    if (!draw || !selected || !selectedRow) return;
    editTargetRef.current = selected;
    setSaveError(null);
    setMode("edit");
    draw.deleteAll();
    if (selectedRow.boundary_geojson) {
      const ids = draw.add({
        type: "Feature",
        geometry: selectedRow.boundary_geojson,
        properties: {},
      });
      draw.changeMode("direct_select", { featureId: ids[0] });
      setEditHint("Drag the points to adjust the boundary, then press Save.");
    } else {
      draw.changeMode("draw_polygon");
      setEditHint("This record has no boundary yet. Draw one, then it saves automatically.");
    }
    setSelected(null);
  }

  async function saveBoundary(entityType: EntityType, id: string, mp: MultiPolygon) {
    const { error } = await supabase.rpc("set_boundary", {
      p_entity_type: entityType,
      p_entity_id: id,
      p_geojson: mp,
    });
    return error;
  }

  // Save handler for edit mode (also called from draw.create when drawing a
  // boundary for an existing record). Kept in a ref so map event closures
  // always see the latest version.
  const saveEditedRef = useRef<(mp?: MultiPolygon) => void>(() => {});
  saveEditedRef.current = async (drawnMp?: MultiPolygon) => {
    const draw = drawRef.current;
    const target = editTargetRef.current;
    if (!draw || !target) return;

    let mp = drawnMp ?? null;
    if (!mp) {
      // Merge every polygon in the draw session into one MultiPolygon.
      const all = draw.getAll().features;
      const parts: MultiPolygon["coordinates"] = [];
      for (const f of all) {
        const m = toMultiPolygon(f.geometry);
        if (m) parts.push(...m.coordinates);
      }
      if (parts.length === 0) {
        setSaveError("No boundary drawn.");
        return;
      }
      mp = { type: "MultiPolygon", coordinates: parts };
    }

    setSaving(true);
    const error = await saveBoundary(target.entityType, target.id, mp);
    setSaving(false);
    if (error) {
      setSaveError("Could not save the boundary. " + error.message);
      return;
    }
    const sel = { ...target };
    cancelDrawEdit();
    await loadData();
    setSelected(sel);
  };

  async function saveNewBoundary(payload: NewBoundaryPayload) {
    if (!pendingGeom) return;
    setSaving(true);
    setSaveError(null);

    const insert: Record<string, unknown> = { organization_id: orgId };
    if (payload.entityType === "parcel") {
      insert.parcel_number = payload.name;
      insert.property_id = payload.propertyId;
    } else {
      insert.name = payload.name;
      if (payload.entityType === "field") {
        insert.property_id = payload.propertyId;
      } else {
        insert.county = payload.county;
        insert.state = payload.state;
      }
    }

    const { data, error } = await supabase
      .from(TABLE[payload.entityType])
      .insert(insert)
      .select("id")
      .single();

    if (error || !data) {
      setSaving(false);
      setSaveError("Could not save. " + (error?.message ?? ""));
      return;
    }

    const boundaryError = await saveBoundary(payload.entityType, data.id, pendingGeom);
    setSaving(false);
    if (boundaryError) {
      setSaveError("Saved the record, but the boundary failed: " + boundaryError.message);
      return;
    }

    cancelDrawEdit();
    await loadData();
    setSelected({ entityType: payload.entityType, id: data.id });
  }

  function fitAll() {
    const map = mapRef.current;
    if (!map) return;
    const box = bboxOf([
      ...properties.map((r) => r.boundary_geojson),
      ...parcels.map((r) => r.boundary_geojson),
      ...fields.map((r) => r.boundary_geojson),
    ]);
    if (box) map.fitBounds(box, { padding: 60 });
  }

  const hasAnyBoundary =
    properties.some((r) => r.boundary_geojson) ||
    parcels.some((r) => r.boundary_geojson) ||
    fields.some((r) => r.boundary_geojson);

  // ---------------------------------------------------------------- render

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 bg-black"
          : "relative h-[calc(100dvh-3.5rem-4rem)] md:h-[calc(100dvh-3.5rem)]"
      }
    >
      {/* Explicit h-full rather than absolute inset-0: mapbox-gl.css forces
          position:relative on this element, which would collapse it to 0 height */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Left control column */}
      <div className="absolute left-3 top-3 z-20 flex w-36 flex-col gap-2">
        <LayerToggle visibility={visibility} onChange={setVisibility} />
        {mode === "view" ? (
          <button
            onClick={startDrawing}
            className="rounded-lg bg-kelly-500 px-3 py-2 text-sm font-semibold text-white shadow-md hover:bg-kelly-600"
          >
            + Draw boundary
          </button>
        ) : null}
        <div className="flex gap-2">
          <button
            onClick={fitAll}
            title="Zoom to all boundaries"
            className="flex-1 rounded-lg bg-white/95 px-2 py-1.5 text-xs font-medium text-gray-700 shadow-md hover:bg-white"
          >
            Zoom all
          </button>
          <button
            onClick={() => setFullscreen((f) => !f)}
            title="Toggle fullscreen"
            className="flex-1 rounded-lg bg-white/95 px-2 py-1.5 text-xs font-medium text-gray-700 shadow-md hover:bg-white"
          >
            {fullscreen ? "Exit full" : "Fullscreen"}
          </button>
        </div>
      </div>

      {/* Draw/edit toolbar */}
      {mode !== "view" ? (
        <div className="absolute inset-x-0 top-3 z-20 mx-auto w-fit max-w-[92%] rounded-lg bg-pine-900/95 px-3 py-2 text-white shadow-lg">
          <p className="text-xs">{editHint}</p>
          <div className="mt-1.5 flex justify-center gap-2">
            {mode === "edit" ? (
              <button
                onClick={() => saveEditedRef.current()}
                disabled={saving}
                className="rounded bg-kelly-500 px-3 py-1 text-xs font-semibold hover:bg-kelly-600 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save boundary"}
              </button>
            ) : null}
            <button
              onClick={cancelDrawEdit}
              className="rounded bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
            >
              Cancel
            </button>
          </div>
          {saveError ? <p className="mt-1 text-xs text-red-300">{saveError}</p> : null}
        </div>
      ) : null}

      {/* Empty state */}
      {!loading && !hasAnyBoundary && mode === "view" ? (
        <div className="absolute inset-x-0 top-16 z-10 mx-auto w-fit max-w-[90%] rounded-lg bg-white/95 px-4 py-3 text-center shadow-lg md:top-3">
          <p className="text-sm font-medium text-gray-800">No boundaries yet</p>
          <p className="text-xs text-gray-500">
            Draw one with the button on the left, or import files from the Import page.
          </p>
        </div>
      ) : null}

      {/* Detail panel / save dialog */}
      {pendingGeom && mode === "draw" ? (
        <NewBoundaryDialog
          approxAcres={approxAcres(pendingGeom)}
          properties={properties}
          saving={saving}
          error={saveError}
          onSave={saveNewBoundary}
          onCancel={cancelDrawEdit}
        />
      ) : null}

      {selected && selectedRow && mode === "view" ? (
        <FeaturePanel
          entityType={selected.entityType}
          row={selectedRow}
          propertyName={selectedPropertyName}
          onClose={() => setSelected(null)}
          onEditBoundary={startEditBoundary}
          onChanged={loadData}
        />
      ) : null}
    </div>
  );
}
