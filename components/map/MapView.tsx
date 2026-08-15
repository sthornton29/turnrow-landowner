"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, { GeoJSONSource, MapMouseEvent } from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiLineString,
  MultiPolygon,
} from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { createClient } from "@/lib/supabase/client";
import {
  approxAcres,
  bboxOf,
  labelPointOf,
  toMultiLineString,
  toMultiPolygon,
} from "@/lib/geo/normalize";
import { ASSET_TYPES } from "@/lib/assetTypes";
import {
  cropColor,
  cropLegend,
  harvestStatus,
  yieldPerAcre,
  yieldUnitLabel,
  type FarmFieldDataRow,
  type FieldMappingRow,
} from "@/lib/farmDisplay";
import type { FarmActivityInfo } from "./FeaturePanel";
import type {
  AssetGeo,
  EntityType,
  FieldGeo,
  ParcelGeo,
  PropertyGeo,
  RoadGeo,
  TimberStandGeo,
} from "@/types/db";
import LayerToggle from "./LayerToggle";
import FeaturePanel, { ENTITY_TABLE } from "./FeaturePanel";
import NewBoundaryDialog, { type NewBoundaryPayload } from "./NewBoundaryDialog";
import NewLineDialog, { type NewLinePayload } from "./NewLineDialog";
import NewAssetDialog, { type NewAssetPayload } from "./NewAssetDialog";
import type { AnyGeoRow, LayerVisibility, MapMode, SelectedFeature } from "./types";

const KELLY = "#39b54a";
const PINE = "#14532d";
const MINT = "#a7f3d0";

const POLYGON_TYPES: EntityType[] = ["property", "parcel", "field", "timber_stand"];

function geomOf(row: AnyGeoRow): Geometry | null {
  if ("boundary_geojson" in row) return row.boundary_geojson;
  if ("geom_geojson" in row) return row.geom_geojson;
  return null;
}

function nameOf(row: AnyGeoRow, entityType: EntityType): string {
  return entityType === "parcel"
    ? (row as ParcelGeo).parcel_number
    : ((row as { name?: string }).name ?? "");
}

function rowsToFC(rows: AnyGeoRow[], entityType: EntityType): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    const g = geomOf(row);
    if (!g) continue;
    const props: Record<string, unknown> = {
      id: row.id,
      entityType,
      name: nameOf(row, entityType),
    };
    if (entityType === "asset") {
      const a = row as AssetGeo;
      props.letter = ASSET_TYPES[a.asset_type]?.letter ?? "A";
    }
    features.push({ type: "Feature", geometry: g, properties: props });
  }
  return { type: "FeatureCollection", features };
}

function rowsToLabelFC(rows: AnyGeoRow[], entityType: EntityType): FeatureCollection {
  const features: Feature[] = [];
  for (const row of rows) {
    const g = geomOf(row);
    if (!g || (g.type !== "MultiPolygon" && g.type !== "Polygon")) continue;
    const mp = toMultiPolygon(g);
    if (!mp) continue;
    const pt = labelPointOf(mp);
    if (!pt) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: pt },
      properties: { name: nameOf(row, entityType) },
    });
  }
  return { type: "FeatureCollection", features };
}

export default function MapView({
  orgId,
  focus,
}: {
  orgId: string;
  focus?: SelectedFeature | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const [properties, setProperties] = useState<PropertyGeo[]>([]);
  const [parcels, setParcels] = useState<ParcelGeo[]>([]);
  const [fields, setFields] = useState<FieldGeo[]>([]);
  const [timber, setTimber] = useState<TimberStandGeo[]>([]);
  const [roads, setRoads] = useState<RoadGeo[]>([]);
  const [assets, setAssets] = useState<AssetGeo[]>([]);
  const [loading, setLoading] = useState(true);
  const [cropsOn, setCropsOn] = useState(false);
  const [farmActivity, setFarmActivity] = useState<{
    byField: Record<string, FarmActivityInfo[]>;
    byProperty: Record<string, FarmActivityInfo[]>;
    legend: Array<{ label: string; color: string }>;
  }>({ byField: {}, byProperty: {}, legend: [] });

  const [mode, setMode] = useState<MapMode>("view");
  const modeRef = useRef<MapMode>("view");
  modeRef.current = mode;

  const [selected, setSelected] = useState<SelectedFeature | null>(null);
  const [visibility, setVisibility] = useState<LayerVisibility>({
    property: true,
    parcel: true,
    field: true,
    timber_stand: true,
    road: true,
    asset: true,
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Draw/save state
  const drawKindRef = useRef<"boundary" | "line" | null>(null);
  const [pendingPoly, setPendingPoly] = useState<MultiPolygon | null>(null);
  const [pendingLine, setPendingLine] = useState<MultiLineString | null>(null);
  const [pendingPoint, setPendingPoint] = useState<[number, number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editTargetRef = useRef<SelectedFeature | null>(null);
  const [editHint, setEditHint] = useState<string | null>(null);
  const didFitRef = useRef(false);
  const didFocusRef = useRef(false);

  // ---------------------------------------------------------------- data

  const loadData = useCallback(async () => {
    const currentYear = new Date().getFullYear();
    const [p, pa, f, t, r, a, mappings, farmData, connections] = await Promise.all([
      supabase.from("properties_geo").select("*").order("name"),
      supabase.from("parcels_geo").select("*").order("parcel_number"),
      supabase.from("fields_geo").select("*").order("name"),
      supabase.from("timber_stands_geo").select("*").order("name"),
      supabase.from("roads_geo").select("*").order("name"),
      supabase.from("assets_geo").select("*").eq("is_active", true).order("name"),
      supabase.from("field_mappings").select("*").eq("status", "confirmed"),
      supabase.from("farm_field_data").select("*").eq("crop_year", currentYear),
      supabase.from("farm_connections").select("id, label"),
    ]);
    setProperties((p.data as PropertyGeo[]) ?? []);
    setParcels((pa.data as ParcelGeo[]) ?? []);
    setFields((f.data as FieldGeo[]) ?? []);
    setTimber((t.data as TimberStandGeo[]) ?? []);
    setRoads((r.data as RoadGeo[]) ?? []);
    setAssets((a.data as AssetGeo[]) ?? []);

    // Current-year farm activity keyed to local fields / properties
    const connectionLabel = new Map(
      ((connections.data as Array<{ id: string; label: string }>) ?? []).map((c) => [c.id, c.label])
    );
    const mappingByKey = new Map(
      ((mappings.data as FieldMappingRow[]) ?? []).map((m) => [
        `${m.farm_connection_id}|${m.remote_field_id}`,
        m,
      ])
    );
    const byField: Record<string, FarmActivityInfo[]> = {};
    const byProperty: Record<string, FarmActivityInfo[]> = {};
    const crops: string[] = [];
    for (const row of ((farmData.data as FarmFieldDataRow[]) ?? [])) {
      const mapping = mappingByKey.get(`${row.farm_connection_id}|${row.remote_field_id}`);
      if (!mapping) continue;
      const perAcre = yieldPerAcre(row);
      const info: FarmActivityInfo = {
        crop: row.crop || "Unknown crop",
        color: cropColor(row.crop),
        varieties: (row.varieties ?? []).map((v) => v.variety),
        planting_date: row.planting_date,
        harvested: harvestStatus(row) === "harvested",
        yieldText:
          perAcre !== null
            ? `${Math.round(perAcre * 10) / 10} ${yieldUnitLabel(row.production_unit)}`
            : null,
        yieldShared: row.yield_shared,
        source: connectionLabel.get(row.farm_connection_id) ?? "Farm connection",
      };
      if (row.crop) crops.push(row.crop);
      if (mapping.local_field_id) {
        byField[mapping.local_field_id] = [...(byField[mapping.local_field_id] ?? []), info];
      } else if (mapping.local_property_id) {
        byProperty[mapping.local_property_id] = [
          ...(byProperty[mapping.local_property_id] ?? []),
          info,
        ];
      }
    }
    setFarmActivity({ byField, byProperty, legend: cropLegend(crops) });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const rowLists: Record<EntityType, AnyGeoRow[]> = useMemo(
    () => ({
      property: properties,
      parcel: parcels,
      field: fields,
      timber_stand: timber,
      road: roads,
      asset: assets,
    }),
    [properties, parcels, fields, timber, roads, assets]
  );

  const selectedRow: AnyGeoRow | null = useMemo(() => {
    if (!selected) return null;
    return rowLists[selected.entityType].find((r) => r.id === selected.id) ?? null;
  }, [selected, rowLists]);

  const selectedPropertyName = useMemo(() => {
    if (!selectedRow || !selected || selected.entityType === "property") return null;
    const pid = (selectedRow as { property_id?: string | null }).property_id;
    if (!pid) return null;
    return properties.find((p) => p.id === pid)?.name ?? null;
  }, [selected, selectedRow, properties]);

  // ---------------------------------------------------------------- map init

  const clickRef = useRef<(e: MapMouseEvent) => void>(() => {});
  clickRef.current = (e) => {
    const map = mapRef.current;
    if (!map || modeRef.current !== "view") return;
    // Priority: assets, then roads, then fields > timber > parcels > properties
    const groups: string[][] = [
      ["assets-circle", "assets-line", "assets-fill"],
      ["roads-hit"],
      ["fields-fill"],
      ["timber-fill"],
      ["parcels-fill"],
      ["properties-fill"],
    ];
    for (const group of groups) {
      const layers = group.filter((l) => map.getLayer(l));
      if (layers.length === 0) continue;
      const hits = map.queryRenderedFeatures(e.point, { layers });
      if (hits.length > 0) {
        const props = hits[0].properties as { id: string; entityType: EntityType };
        setSelected({ entityType: props.entityType, id: props.id });
        return;
      }
    }
    setSelected(null);
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

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new mapboxgl.GeolocateControl({ showUserLocation: true }), "bottom-right");

    const draw = new MapboxDraw({ displayControlsDefault: false });
    map.addControl(draw);
    drawRef.current = draw;

    map.on("load", () => {
      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      for (const id of [
        "properties", "parcels", "fields", "timber", "roads", "assets",
        "property-labels", "parcel-labels", "field-labels", "timber-labels",
      ]) {
        map.addSource(id, { type: "geojson", data: empty });
      }

      // Properties: white outline
      map.addLayer({ id: "properties-fill", type: "fill", source: "properties",
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.05 } });
      map.addLayer({ id: "properties-line", type: "line", source: "properties",
        paint: { "line-color": "#ffffff", "line-width": 2.5 } });

      // Parcels: thin dashed light line
      map.addLayer({ id: "parcels-fill", type: "fill", source: "parcels",
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.02 } });
      map.addLayer({ id: "parcels-line", type: "line", source: "parcels",
        paint: { "line-color": "#e5e7eb", "line-width": 1.4, "line-dasharray": [2, 2] } });

      // Timber stands: darker green fill, light dashed outline (reads
      // differently from the solid kelly ag fields)
      map.addLayer({ id: "timber-fill", type: "fill", source: "timber",
        paint: { "fill-color": PINE, "fill-opacity": 0.35 } });
      map.addLayer({ id: "timber-line", type: "line", source: "timber",
        paint: { "line-color": MINT, "line-width": 1.8, "line-dasharray": [3, 2] } });

      // Fields: kelly green
      map.addLayer({ id: "fields-fill", type: "fill", source: "fields",
        paint: { "fill-color": KELLY, "fill-opacity": 0.18 } });
      map.addLayer({ id: "fields-line", type: "line", source: "fields",
        paint: { "line-color": KELLY, "line-width": 2 } });

      // Roads: white line over a dark casing, plus an invisible wide hit line
      map.addLayer({ id: "roads-casing", type: "line", source: "roads",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PINE, "line-width": 4.5 } });
      map.addLayer({ id: "roads-line", type: "line", source: "roads",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 2 } });
      map.addLayer({ id: "roads-hit", type: "line", source: "roads",
        paint: { "line-color": "#ffffff", "line-width": 16, "line-opacity": 0.01 } });

      // Asset lines (pipe, fence): dashed light blue, distinct from roads.
      // Asset polygons (footprints, pond surface): faint white.
      map.addLayer({ id: "assets-fill", type: "fill", source: "assets",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.08 } });
      map.addLayer({ id: "assets-outline", type: "line", source: "assets",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": "#bae6fd", "line-width": 1.5 } });
      map.addLayer({ id: "assets-line", type: "line", source: "assets",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#bae6fd", "line-width": 2, "line-dasharray": [2, 2] } });

      // Selection highlights
      for (const src of ["properties", "parcels", "fields", "timber"]) {
        map.addLayer({ id: `${src}-selected`, type: "line", source: src,
          paint: { "line-color": "#ffffff", "line-width": 4.5 },
          filter: ["==", ["get", "id"], ""] });
      }
      map.addLayer({ id: "roads-selected", type: "line", source: "roads",
        paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.9 },
        filter: ["==", ["get", "id"], ""] });
      map.addLayer({ id: "assets-selected-line", type: "line", source: "assets",
        paint: { "line-color": "#ffffff", "line-width": 4.5 },
        filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "id"], ""]] });

      // Labels
      map.addLayer({ id: "property-labels", type: "symbol", source: "property-labels",
        layout: { "text-field": ["get", "name"], "text-size": 14,
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"] },
        paint: { "text-color": "#ffffff", "text-halo-color": PINE, "text-halo-width": 1.4 } });
      map.addLayer({ id: "field-labels", type: "symbol", source: "field-labels",
        layout: { "text-field": ["get", "name"], "text-size": 11.5,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#eafcee", "text-halo-color": PINE, "text-halo-width": 1.2 } });
      map.addLayer({ id: "timber-labels", type: "symbol", source: "timber-labels",
        layout: { "text-field": ["get", "name"], "text-size": 11,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": MINT, "text-halo-color": PINE, "text-halo-width": 1.2 } });
      map.addLayer({ id: "parcel-labels", type: "symbol", source: "parcel-labels",
        layout: { "text-field": ["get", "name"], "text-size": 10,
          "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#e5e7eb", "text-halo-color": "#374151", "text-halo-width": 1 } });
      map.addLayer({ id: "road-labels", type: "symbol", source: "roads",
        layout: { "symbol-placement": "line", "text-field": ["get", "name"],
          "text-size": 10, "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#ffffff", "text-halo-color": PINE, "text-halo-width": 1.2 } });

      // Asset markers on top: branded circle + type letter + name below
      map.addLayer({ id: "assets-circle", type: "circle", source: "assets",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 10, "circle-color": PINE,
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "assets-letter", type: "symbol", source: "assets",
        filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": ["get", "letter"], "text-size": 9,
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" } });
      map.addLayer({ id: "assets-name", type: "symbol", source: "assets",
        filter: ["==", ["geometry-type"], "Point"], minzoom: 12,
        layout: { "text-field": ["get", "name"], "text-size": 10,
          "text-offset": [0, 1.6],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#ffffff", "text-halo-color": PINE, "text-halo-width": 1.2 } });

      setMapLoaded(true);
    });

    map.on("click", (e) => clickRef.current(e));
    for (const layer of [
      "properties-fill", "parcels-fill", "fields-fill", "timber-fill",
      "roads-hit", "assets-circle", "assets-line", "assets-fill",
    ]) {
      map.on("mouseenter", layer, () => {
        if (modeRef.current === "view") map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    map.on("draw.create", (e: { features: Feature[] }) => {
      const geometry = e.features[0]?.geometry;
      if (!geometry) return;
      if (editTargetRef.current) {
        saveEditedRef.current();
        return;
      }
      if (drawKindRef.current === "line") {
        const ml = toMultiLineString(geometry);
        if (ml) setPendingLine(ml);
      } else {
        const mp = toMultiPolygon(geometry);
        if (mp) setPendingPoly(mp);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- sync data

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const setData = (source: string, fc: FeatureCollection) =>
      (map.getSource(source) as GeoJSONSource)?.setData(fc);

    setData("properties", rowsToFC(properties, "property"));
    setData("parcels", rowsToFC(parcels, "parcel"));
    // Fields carry their current-year crop color for the Crops toggle
    const fieldsFC = rowsToFC(fields, "field");
    for (const feature of fieldsFC.features) {
      const activity = farmActivity.byField[String(feature.properties?.id)];
      if (activity?.length) {
        feature.properties = { ...feature.properties, cropColor: activity[0].color };
      }
    }
    setData("fields", fieldsFC);
    setData("timber", rowsToFC(timber, "timber_stand"));
    setData("roads", rowsToFC(roads, "road"));
    setData("assets", rowsToFC(assets, "asset"));
    setData("property-labels", rowsToLabelFC(properties, "property"));
    setData("parcel-labels", rowsToLabelFC(parcels, "parcel"));
    setData("field-labels", rowsToLabelFC(fields, "field"));
    setData("timber-labels", rowsToLabelFC(timber, "timber_stand"));

    if (!didFitRef.current) {
      const box = bboxOf([
        ...properties.map(geomOf), ...parcels.map(geomOf), ...fields.map(geomOf),
        ...timber.map(geomOf), ...roads.map(geomOf), ...assets.map(geomOf),
      ]);
      if (box) {
        map.fitBounds(box, { padding: 60, duration: 0 });
        didFitRef.current = true;
      }
    }
  }, [mapLoaded, properties, parcels, fields, timber, roads, assets, farmActivity]);

  // Crops toggle: recolor field polygons by current-year crop
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getLayer("fields-fill")) return;
    if (cropsOn) {
      map.setPaintProperty("fields-fill", "fill-color", [
        "coalesce",
        ["get", "cropColor"],
        "#6b7280",
      ]);
      map.setPaintProperty("fields-fill", "fill-opacity", [
        "case",
        ["has", "cropColor"],
        0.55,
        0.08,
      ]);
      map.setPaintProperty("fields-line", "line-color", [
        "coalesce",
        ["get", "cropColor"],
        KELLY,
      ]);
    } else {
      map.setPaintProperty("fields-fill", "fill-color", KELLY);
      map.setPaintProperty("fields-fill", "fill-opacity", 0.18);
      map.setPaintProperty("fields-line", "line-color", KELLY);
    }
  }, [cropsOn, mapLoaded, farmActivity]);

  // Focus an entity passed in from another page (e.g. asset list "show on map")
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || loading || !focus || didFocusRef.current) return;
    didFocusRef.current = true;
    const row = rowLists[focus.entityType]?.find((r) => r.id === focus.id);
    if (!row) return;
    setSelected(focus);
    const g = geomOf(row);
    const box = g ? bboxOf([g]) : null;
    if (box) {
      if (g?.type === "Point") {
        map.flyTo({ center: box.slice(0, 2) as [number, number], zoom: 16 });
      } else {
        map.fitBounds(box, { padding: 80, maxZoom: 16 });
      }
    }
  }, [mapLoaded, loading, focus, rowLists]);

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const groups: Array<[keyof LayerVisibility, string[]]> = [
      ["property", ["properties-fill", "properties-line", "property-labels"]],
      ["parcel", ["parcels-fill", "parcels-line", "parcel-labels"]],
      ["field", ["fields-fill", "fields-line", "field-labels"]],
      ["timber_stand", ["timber-fill", "timber-line", "timber-labels"]],
      ["road", ["roads-casing", "roads-line", "roads-hit", "road-labels"]],
      ["asset", ["assets-fill", "assets-outline", "assets-line", "assets-circle", "assets-letter", "assets-name"]],
    ];
    for (const [key, layers] of groups) {
      for (const layer of layers) {
        if (map.getLayer(layer)) {
          map.setLayoutProperty(layer, "visibility", visibility[key] ? "visible" : "none");
        }
      }
    }
  }, [visibility, mapLoaded]);

  // Selection highlight
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const bySource: Record<string, string> = {
      properties: "", parcels: "", fields: "", timber: "", roads: "", assets: "",
    };
    if (selected) {
      const srcName: Record<EntityType, string> = {
        property: "properties", parcel: "parcels", field: "fields",
        timber_stand: "timber", road: "roads", asset: "assets",
      };
      bySource[srcName[selected.entityType]] = selected.id;
    }
    for (const src of ["properties", "parcels", "fields", "timber"]) {
      if (map.getLayer(`${src}-selected`)) {
        map.setFilter(`${src}-selected`, ["==", ["get", "id"], bySource[src]]);
      }
    }
    if (map.getLayer("roads-selected")) {
      map.setFilter("roads-selected", ["==", ["get", "id"], bySource.roads]);
    }
    if (map.getLayer("assets-selected-line")) {
      map.setFilter("assets-selected-line",
        ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "id"], bySource.assets]]);
    }
    if (map.getLayer("assets-circle")) {
      map.setPaintProperty("assets-circle", "circle-stroke-color",
        ["case", ["==", ["get", "id"], bySource.assets], KELLY, "#ffffff"]);
      map.setPaintProperty("assets-circle", "circle-stroke-width",
        ["case", ["==", ["get", "id"], bySource.assets], 3.5, 2]);
    }
  }, [selected, mapLoaded]);

  useEffect(() => {
    mapRef.current?.resize();
  }, [fullscreen]);

  // ---------------------------------------------------------------- actions

  function resetDrawState() {
    drawRef.current?.deleteAll();
    setMode("view");
    setPendingPoly(null);
    setPendingLine(null);
    setPendingPoint(null);
    setSaveError(null);
    setEditHint(null);
    drawKindRef.current = null;
    editTargetRef.current = null;
  }

  function startAdd(kind: "boundary" | "line" | "asset_point") {
    const draw = drawRef.current;
    if (!draw) return;
    setAddMenuOpen(false);
    setSelected(null);
    setSaveError(null);
    editTargetRef.current = null;
    if (kind === "asset_point") {
      setMode("place");
      setEditHint("Pan the map to line up the crosshair, then press Place here.");
      return;
    }
    drawKindRef.current = kind;
    setMode("draw");
    draw.deleteAll();
    if (kind === "boundary") {
      setEditHint("Tap the map to add points. Double tap the last point to finish.");
      draw.changeMode("draw_polygon");
    } else {
      setEditHint("Tap along the line. Double tap the last point to finish.");
      draw.changeMode("draw_line_string");
    }
  }

  function startEditGeometry() {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map || !selected || !selectedRow) return;
    const g = geomOf(selectedRow);
    editTargetRef.current = selected;
    setSaveError(null);
    setSelected(null);

    const isPoint = g?.type === "Point" || g?.type === "MultiPoint";
    const isLineTarget =
      selected.entityType === "road" ||
      (selected.entityType === "asset" &&
        (g?.type === "LineString" || g?.type === "MultiLineString"));

    if (selected.entityType === "asset" && (isPoint || !g)) {
      // Move a pin (or place one for an asset with no location): crosshair mode
      if (g?.type === "Point") {
        map.flyTo({ center: g.coordinates as [number, number], zoom: Math.max(map.getZoom(), 15) });
      }
      setMode("place");
      setEditHint("Pan the map to the new spot, then press Place here.");
      return;
    }

    setMode("edit");
    draw.deleteAll();
    if (g) {
      const ids = draw.add({ type: "Feature", geometry: g, properties: {} });
      draw.changeMode("direct_select", { featureId: ids[0] });
      setEditHint("Drag the points to adjust, then press Save.");
    } else if (isLineTarget || selected.entityType === "road") {
      draw.changeMode("draw_line_string");
      setEditHint("No line yet. Draw one; it saves when you finish.");
    } else {
      draw.changeMode("draw_polygon");
      setEditHint("No boundary yet. Draw one; it saves when you finish.");
    }
  }

  async function applyGeometry(target: SelectedFeature, geojson: Geometry) {
    const { error } = await supabase.rpc("set_geometry", {
      p_entity_type: target.entityType,
      p_entity_id: target.id,
      p_geojson: geojson,
    });
    return error;
  }

  const saveEditedRef = useRef<() => void>(() => {});
  saveEditedRef.current = async () => {
    const draw = drawRef.current;
    const target = editTargetRef.current;
    if (!draw || !target) return;

    const all = draw.getAll().features;
    let g: Geometry | null = null;
    const isLineTarget =
      target.entityType === "road" ||
      (target.entityType === "asset" &&
        all.some((f) => f.geometry.type.includes("Line")));
    if (isLineTarget) {
      const parts: MultiLineString["coordinates"] = [];
      for (const f of all) {
        const ml = toMultiLineString(f.geometry);
        if (ml) parts.push(...ml.coordinates);
      }
      if (parts.length > 0) g = { type: "MultiLineString", coordinates: parts };
    } else {
      const parts: MultiPolygon["coordinates"] = [];
      for (const f of all) {
        const mp = toMultiPolygon(f.geometry);
        if (mp) parts.push(...mp.coordinates);
      }
      if (parts.length > 0) g = { type: "MultiPolygon", coordinates: parts };
    }
    if (!g) {
      setSaveError("Nothing drawn yet.");
      return;
    }

    setSaving(true);
    const error = await applyGeometry(target, g);
    setSaving(false);
    if (error) {
      setSaveError("Could not save. " + error.message);
      return;
    }
    const sel = { ...target };
    resetDrawState();
    await loadData();
    setSelected(sel);
  };

  async function placeHere() {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const target = editTargetRef.current;
    if (target) {
      // Moving an existing asset pin
      setSaving(true);
      const error = await applyGeometry(target, {
        type: "Point",
        coordinates: [center.lng, center.lat],
      });
      setSaving(false);
      if (error) {
        setSaveError("Could not save the location. " + error.message);
        return;
      }
      const sel = { ...target };
      resetDrawState();
      await loadData();
      setSelected(sel);
    } else {
      setPendingPoint([center.lng, center.lat]);
    }
  }

  function useMyLocation() {
    const map = mapRef.current;
    if (!map || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17 });
      },
      () => setSaveError("Could not get your location.")
    );
  }

  async function insertAndSetGeometry(
    table: string,
    insert: Record<string, unknown>,
    entityType: EntityType,
    geometry: Geometry
  ): Promise<SelectedFeature | null> {
    const { data, error } = await supabase.from(table).insert(insert).select("id").single();
    if (error || !data) {
      setSaveError("Could not save. " + (error?.message ?? ""));
      return null;
    }
    const gErr = await applyGeometry({ entityType, id: data.id }, geometry);
    if (gErr) {
      setSaveError("Saved the record, but the geometry failed: " + gErr.message);
      return null;
    }
    return { entityType, id: data.id };
  }

  async function saveNewBoundary(payload: NewBoundaryPayload) {
    if (!pendingPoly) return;
    setSaving(true);
    setSaveError(null);
    const base: Record<string, unknown> = { organization_id: orgId };
    if (payload.entityType === "parcel") {
      base.parcel_number = payload.name;
      base.property_id = payload.propertyId;
    } else if (payload.entityType === "property") {
      base.name = payload.name;
      base.county = payload.county;
      base.state = payload.state;
    } else {
      base.name = payload.name;
      base.property_id = payload.propertyId;
    }
    const sel = await insertAndSetGeometry(
      ENTITY_TABLE[payload.entityType], base, payload.entityType, pendingPoly
    );
    setSaving(false);
    if (sel) {
      resetDrawState();
      await loadData();
      setSelected(sel);
    }
  }

  async function saveNewLine(payload: NewLinePayload) {
    if (!pendingLine) return;
    setSaving(true);
    setSaveError(null);
    let sel: SelectedFeature | null = null;
    if (payload.kind === "road") {
      sel = await insertAndSetGeometry(
        "roads",
        { organization_id: orgId, property_id: payload.propertyId,
          name: payload.name, road_type: payload.roadType },
        "road", pendingLine
      );
    } else {
      sel = await insertAndSetGeometry(
        "assets",
        { organization_id: orgId, property_id: payload.propertyId,
          name: payload.name, asset_type: payload.kind },
        "asset", pendingLine
      );
    }
    setSaving(false);
    if (sel) {
      resetDrawState();
      await loadData();
      setSelected(sel);
    }
  }

  async function saveNewAsset(payload: NewAssetPayload) {
    if (!pendingPoint) return;
    setSaving(true);
    setSaveError(null);
    const sel = await insertAndSetGeometry(
      "assets",
      { organization_id: orgId, property_id: payload.propertyId,
        name: payload.name, asset_type: payload.assetType },
      "asset", { type: "Point", coordinates: pendingPoint }
    );
    setSaving(false);
    if (sel) {
      resetDrawState();
      await loadData();
      setSelected(sel);
    }
  }

  function fitAll() {
    const map = mapRef.current;
    if (!map) return;
    const box = bboxOf([
      ...properties.map(geomOf), ...parcels.map(geomOf), ...fields.map(geomOf),
      ...timber.map(geomOf), ...roads.map(geomOf), ...assets.map(geomOf),
    ]);
    if (box) map.fitBounds(box, { padding: 60 });
  }

  const hasAnything = Object.values(rowLists).some((rows) => rows.some(geomOf));

  // ---------------------------------------------------------------- render

  const showCrosshair = mode === "place" && !pendingPoint;

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

      {/* Crosshair for asset pin placement */}
      {showCrosshair ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <svg viewBox="0 0 48 48" className="h-12 w-12 drop-shadow">
            <circle cx="24" cy="24" r="10" fill="none" stroke="#ffffff" strokeWidth="2.5" />
            <circle cx="24" cy="24" r="2.5" fill={KELLY} />
            <path d="M24 2v10M24 36v10M2 24h10M36 24h10" stroke="#ffffff" strokeWidth="2.5" />
          </svg>
        </div>
      ) : null}

      {/* Left control column */}
      <div className="absolute left-3 top-3 z-20 flex w-36 flex-col gap-2">
        <LayerToggle visibility={visibility} onChange={setVisibility} />
        {Object.keys(farmActivity.byField).length > 0 ? (
          <div className="rounded-lg bg-white/95 p-2 shadow-md">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={cropsOn}
                onChange={(e) => setCropsOn(e.target.checked)}
                className="h-4 w-4 accent-kelly-500"
              />
              Crops
            </label>
            {cropsOn ? (
              <div className="mt-1 space-y-0.5">
                {farmActivity.legend.map((entry) => (
                  <p key={entry.label} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <span
                      className="h-3 w-3 rounded-[2px] border border-gray-300"
                      style={{ background: entry.color }}
                    />
                    {entry.label}
                  </p>
                ))}
                <p className="flex items-center gap-1.5 text-xs text-gray-700">
                  <span className="h-3 w-3 rounded-[2px] border border-gray-300 bg-gray-500" />
                  No data
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        {mode === "view" ? (
          <div className="relative">
            <button
              onClick={() => setAddMenuOpen((o) => !o)}
              className="w-full rounded-lg bg-kelly-500 px-3 py-2 text-sm font-semibold text-white shadow-md hover:bg-kelly-600"
            >
              + Add
            </button>
            {addMenuOpen ? (
              <div className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg bg-white shadow-lg">
                {(
                  [
                    ["boundary", "Boundary (field, timber...)"],
                    ["line", "Road, pipe, or fence"],
                    ["asset_point", "Asset pin (well, bin...)"],
                  ] as Array<["boundary" | "line" | "asset_point", string]>
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    onClick={() => startAdd(kind)}
                    className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-kelly-50"
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            onClick={fitAll}
            title="Zoom to everything"
            className="flex-1 rounded-lg bg-white/95 px-2 py-1.5 text-xs font-medium text-gray-700 shadow-md hover:bg-white"
          >
            Zoom all
          </button>
          <button
            onClick={() => setFullscreen((f) => !f)}
            className="flex-1 rounded-lg bg-white/95 px-2 py-1.5 text-xs font-medium text-gray-700 shadow-md hover:bg-white"
          >
            {fullscreen ? "Exit full" : "Fullscreen"}
          </button>
        </div>
      </div>

      {/* Draw/edit/place toolbar */}
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
                {saving ? "Saving..." : "Save"}
              </button>
            ) : null}
            {mode === "place" && !pendingPoint ? (
              <>
                <button
                  onClick={placeHere}
                  disabled={saving}
                  className="rounded bg-kelly-500 px-3 py-1 text-xs font-semibold hover:bg-kelly-600 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Place here"}
                </button>
                <button
                  onClick={useMyLocation}
                  className="rounded bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
                >
                  My location
                </button>
              </>
            ) : null}
            <button
              onClick={resetDrawState}
              className="rounded bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
            >
              Cancel
            </button>
          </div>
          {saveError ? <p className="mt-1 text-xs text-red-300">{saveError}</p> : null}
        </div>
      ) : null}

      {/* Empty state */}
      {!loading && !hasAnything && mode === "view" ? (
        <div className="absolute inset-x-0 top-16 z-10 mx-auto w-fit max-w-[90%] rounded-lg bg-white/95 px-4 py-3 text-center shadow-lg md:top-3">
          <p className="text-sm font-medium text-gray-800">Nothing on the map yet</p>
          <p className="text-xs text-gray-500">
            Fastest start: Import, then {'"'}Import from county records{'"'}. Or
            draw with the Add button on the left.
          </p>
        </div>
      ) : null}

      {/* Save dialogs */}
      {pendingPoly && mode === "draw" ? (
        <NewBoundaryDialog
          approxAcres={approxAcres(pendingPoly)}
          properties={properties}
          saving={saving}
          error={saveError}
          onSave={saveNewBoundary}
          onCancel={resetDrawState}
        />
      ) : null}
      {pendingLine && mode === "draw" ? (
        <NewLineDialog
          properties={properties}
          saving={saving}
          error={saveError}
          onSave={saveNewLine}
          onCancel={resetDrawState}
        />
      ) : null}
      {pendingPoint && mode === "place" ? (
        <NewAssetDialog
          properties={properties}
          saving={saving}
          error={saveError}
          onSave={saveNewAsset}
          onCancel={resetDrawState}
        />
      ) : null}

      {selected && selectedRow && mode === "view" ? (
        <FeaturePanel
          entityType={selected.entityType}
          row={selectedRow}
          propertyName={selectedPropertyName}
          farmActivity={
            selected.entityType === "field"
              ? (farmActivity.byField[selected.id] ?? null)
              : selected.entityType === "property"
                ? (farmActivity.byProperty[selected.id] ?? null)
                : null
          }
          onClose={() => setSelected(null)}
          onEditGeometry={startEditGeometry}
          onChanged={loadData}
        />
      ) : null}
    </div>
  );
}
