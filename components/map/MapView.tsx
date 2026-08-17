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
  Polygon,
} from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { createClient } from "@/lib/supabase/client";
import { formatAcres } from "@/lib/format";
import {
  approxAcres,
  bboxOf,
  labelPointOf,
  toMultiLineString,
  toMultiPolygon,
} from "@/lib/geo/normalize";
import { ASSET_TYPES, STAND_TYPE_COLORS, STAND_TYPE_LABELS } from "@/lib/assetTypes";
import { entityColor } from "@/lib/entities";
import { suggestPropertyId } from "@/lib/geo/propertyMatch";
import {
  bearingTo,
  compositeFromDetails,
  compositePivotGeometry,
  destination as pivotDestination,
  detailsFromComposite,
  distanceFt,
  lateralGeometry,
  snapEndBearing,
  sweepDegrees,
  type CompositePivotParams,
  type PivotPosition,
} from "@/lib/geo/pivot";
import turfBuffer from "@turf/buffer";
import turfDifference from "@turf/difference";
import turfUnion from "@turf/union";
import turfArea from "@turf/area";
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
  PastureGeo,
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
// Pastures: warm tan, distinct from kelly (ag fields), canola light
// green, wheat amber, the timber palette, and pivot blue.
const PASTURE_TAN = "#d2b48c";

const POLYGON_TYPES: EntityType[] = [
  "property", "parcel", "field", "pasture", "timber_stand",
];

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
      props.assetType = a.asset_type;
    }
    if (entityType === "timber_stand") {
      props.standType = (row as TimberStandGeo).stand_type ?? "other";
    }
    features.push({ type: "Feature", geometry: g, properties: props });
    // Pivot circles and laterals keep their letter marker at the
    // primary center for low-zoom recognition (clickable like the
    // polygon).
    if (entityType === "asset") {
      const a = row as AssetGeo;
      if (
        (a.asset_type === "irrigation_pivot" || a.asset_type === "irrigation_lateral") &&
        g.type !== "Point"
      ) {
        const lon = Number(a.details?.center_lon);
        const lat = Number(a.details?.center_lat);
        const mp = toMultiPolygon(g);
        const center =
          Number.isFinite(lon) && Number.isFinite(lat)
            ? ([lon, lat] as [number, number])
            : mp
              ? labelPointOf(mp)
              : null;
        if (center) {
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: center },
            properties: { ...props },
          });
        }
      }
    }
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
  const [pastures, setPastures] = useState<PastureGeo[]>([]);
  const [timber, setTimber] = useState<TimberStandGeo[]>([]);
  const [roads, setRoads] = useState<RoadGeo[]>([]);
  const [assets, setAssets] = useState<AssetGeo[]>([]);
  const [loading, setLoading] = useState(true);
  const [cropsOn, setCropsOn] = useState(false);
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [entityColorsOn, setEntityColorsOn] = useState(false);
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
    pasture: true,
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
  // Boolean editing: draw a polygon to add to or cut from the boundary
  // being edited (or the one being created). Results may be
  // non-contiguous; everything stores as MultiPolygon anyway.
  const boundaryOpRef = useRef<"add" | "subtract" | null>(null);
  const [editTargetType, setEditTargetType] = useState<EntityType | null>(null);
  const [pendingExtraDraw, setPendingExtraDraw] = useState(false);
  const pendingPolyRef = useRef<MultiPolygon | null>(null);
  pendingPolyRef.current = pendingPoly;
  // Completed features currently on the draw canvas; anything else is
  // the in-progress shape, which "Discard shape" (or Escape) removes
  // WITHOUT touching completed areas or the save form.
  const completedDrawIdsRef = useRef<Set<string>>(new Set());
  const [drawingShape, setDrawingShape] = useState(false);
  const drawingShapeRef = useRef(setDrawingShape);
  drawingShapeRef.current = setDrawingShape;

  // Parametric pivot coverage editor: the geometry is always derived
  // from the composite params (base circle/arc + extension zones +
  // skips + cutouts + towable positions); never vertex-edited.
  // assetId null = a NEW pivot from the Add menu (crosshair placed the
  // center); Save then asks for name/property before inserting.
  const [pivotEdit, setPivotEdit] = useState<{
    assetId: string | null;
    params: CompositePivotParams;
  } | null>(null);
  const pivotEditRef = useRef(pivotEdit);
  pivotEditRef.current = pivotEdit;
  // Drawing an exclusion cutout (pond, road) inside the pivot editor.
  const pivotCutoutRef = useRef(false);
  const [drawingCutout, setDrawingCutout] = useState(false);
  // Crosshair placement is for a new pivot's center (Add menu), not an
  // asset pin.
  const placeForPivotRef = useRef(false);
  const [pendingPivotSave, setPendingPivotSave] = useState(false);

  // Crosshair position in container pixels; null = screen center. The
  // crosshair is DRAGGABLE (touch/click and drag the marker) and the
  // map still pans beneath it; fine-tune by either method. Place here
  // confirms wherever it sits.
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number } | null>(null);
  const crosshairPosRef = useRef(crosshairPos);
  crosshairPosRef.current = crosshairPos;
  const crosshairDragRef = useRef(false);

  function crosshairPointerMove(e: React.PointerEvent) {
    if (!crosshairDragRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCrosshairPos({
      x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
    });
  }
  const didFitRef = useRef(false);
  const didFocusRef = useRef(false);

  // ---------------------------------------------------------------- data

  const loadData = useCallback(async () => {
    const currentYear = new Date().getFullYear();
    const [p, pa, f, pas, t, r, a, mappings, farmData, connections, ents] = await Promise.all([
      supabase.from("properties_geo").select("*").order("name"),
      supabase.from("parcels_geo").select("*").order("parcel_number"),
      supabase.from("fields_geo").select("*").order("name"),
      supabase.from("pastures_geo").select("*").order("name"),
      supabase.from("timber_stands_geo").select("*").order("name"),
      supabase.from("roads_geo").select("*").order("name"),
      supabase.from("assets_geo").select("*").eq("is_active", true).order("name"),
      supabase.from("field_mappings").select("*").eq("status", "confirmed"),
      supabase.from("farm_field_data").select("*").eq("crop_year", currentYear),
      supabase.from("farm_connections").select("id, label"),
      supabase.from("entities").select("id, name").order("name"),
    ]);
    setEntities((ents.data as Array<{ id: string; name: string }>) ?? []);
    setProperties((p.data as PropertyGeo[]) ?? []);
    setParcels((pa.data as ParcelGeo[]) ?? []);
    setFields((f.data as FieldGeo[]) ?? []);
    setPastures((pas.data as PastureGeo[]) ?? []);
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
      pasture: pastures,
      timber_stand: timber,
      road: roads,
      asset: assets,
    }),
    [properties, parcels, fields, pastures, timber, roads, assets]
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

  // Holding entity for a selected property's panel
  const selectedEntityName = useMemo(() => {
    if (!selectedRow || !selected || selected.entityType !== "property") return null;
    const entityId = (selectedRow as PropertyGeo).entity_id;
    if (!entityId) return null;
    return entities.find((e) => e.id === entityId)?.name ?? null;
  }, [selected, selectedRow, entities]);

  // ---------------------------------------------------------------- map init

  const clickRef = useRef<(e: MapMouseEvent) => void>(() => {});
  clickRef.current = (e) => {
    const map = mapRef.current;
    if (!map || modeRef.current !== "view") return;
    // Priority: assets, then roads, then ag fields > pastures > timber >
    // parcels > properties
    const groups: string[][] = [
      ["assets-circle", "assets-line", "assets-fill", "pivot-circles-fill"],
      ["roads-hit"],
      ["fields-fill"],
      ["pastures-fill"],
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

    // keybindings off: Escape is handled by our discard-shape logic so
    // it never kills a whole multi-area session.
    const draw = new MapboxDraw({ displayControlsDefault: false, keybindings: false });
    map.addControl(draw);
    drawRef.current = draw;

    map.on("load", () => {
      const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
      for (const id of [
        "properties", "parcels", "fields", "pastures", "timber", "roads", "assets",
        "property-labels", "parcel-labels", "field-labels", "pasture-labels",
        "timber-labels",
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

      // Timber stands: prominent per-type fills (field-like presence),
      // solid same-color outline; palette in lib/assetTypes.ts.
      const timberColor: mapboxgl.Expression = [
        "match", ["get", "standType"],
        "planted_pine", STAND_TYPE_COLORS.planted_pine,
        "natural_pine", STAND_TYPE_COLORS.natural_pine,
        "hardwood", STAND_TYPE_COLORS.hardwood,
        "mixed", STAND_TYPE_COLORS.mixed,
        STAND_TYPE_COLORS.other,
      ];
      map.addLayer({ id: "timber-fill", type: "fill", source: "timber",
        paint: { "fill-color": timberColor, "fill-opacity": 0.35 } });
      map.addLayer({ id: "timber-line", type: "line", source: "timber",
        paint: { "line-color": timberColor, "line-width": 2 } });

      // Pastures: warm tan (present but not emphasized)
      map.addLayer({ id: "pastures-fill", type: "fill", source: "pastures",
        paint: { "fill-color": PASTURE_TAN, "fill-opacity": 0.25 } });
      map.addLayer({ id: "pastures-line", type: "line", source: "pastures",
        paint: { "line-color": PASTURE_TAN, "line-width": 2 } });

      // Ag fields: kelly green
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
      // Asset polygons (footprints, pond surface): faint white. Pivot
      // coverage circles get their own light blue look below.
      const IRRIGATION_TYPES = ["irrigation_pivot", "irrigation_lateral"];
      const isIrrigation: mapboxgl.Expression = [
        "in", ["get", "assetType"], ["literal", IRRIGATION_TYPES],
      ];
      const notPivot: mapboxgl.Expression = ["!", isIrrigation];
      map.addLayer({ id: "assets-fill", type: "fill", source: "assets",
        filter: ["all", ["==", ["geometry-type"], "Polygon"], notPivot],
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.08 } });
      map.addLayer({ id: "assets-outline", type: "line", source: "assets",
        filter: ["all", ["==", ["geometry-type"], "Polygon"], notPivot],
        paint: { "line-color": "#bae6fd", "line-width": 1.5 } });
      map.addLayer({ id: "pivot-circles-fill", type: "fill", source: "assets",
        filter: ["all", ["==", ["geometry-type"], "Polygon"], isIrrigation],
        paint: { "fill-color": "#7dd3fc", "fill-opacity": 0.18 } });
      map.addLayer({ id: "pivot-circles-line", type: "line", source: "assets",
        filter: ["all", ["==", ["geometry-type"], "Polygon"], isIrrigation],
        paint: { "line-color": "#38bdf8", "line-width": 2 } });
      map.addLayer({ id: "assets-line", type: "line", source: "assets",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#bae6fd", "line-width": 2, "line-dasharray": [2, 2] } });

      // Selection highlights
      for (const src of ["properties", "parcels", "fields", "pastures", "timber"]) {
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
      // Property names always render (no collision hiding: the basemap's
      // street labels and our parcel/road labels otherwise crowd them
      // out) and scale up with zoom so they stay prominent.
      map.addLayer({ id: "property-labels", type: "symbol", source: "property-labels",
        layout: { "text-field": ["get", "name"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 12, 12, 16, 16, 20],
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true },
        paint: { "text-color": "#ffffff", "text-halo-color": PINE, "text-halo-width": 2 } });
      map.addLayer({ id: "field-labels", type: "symbol", source: "field-labels",
        layout: { "text-field": ["get", "name"], "text-size": 11.5,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#eafcee", "text-halo-color": PINE, "text-halo-width": 1.2 } });
      map.addLayer({ id: "pasture-labels", type: "symbol", source: "pasture-labels",
        layout: { "text-field": ["get", "name"], "text-size": 11.5,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#f5ead7", "text-halo-color": "#57431f", "text-halo-width": 1.2 } });
      map.addLayer({ id: "timber-labels", type: "symbol", source: "timber-labels",
        layout: { "text-field": ["get", "name"], "text-size": 11.5,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#ffffff", "text-halo-color": PINE, "text-halo-width": 1.3 } });
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

      // Pivot coverage circle editor: live preview + drag handles.
      map.addSource("pivot-preview", { type: "geojson", data: empty });
      map.addSource("pivot-handles", { type: "geojson", data: empty });
      map.addLayer({ id: "pivot-preview-fill", type: "fill", source: "pivot-preview",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.2 } });
      map.addLayer({ id: "pivot-preview-line", type: "line", source: "pivot-preview",
        paint: { "line-color": "#38bdf8", "line-width": 2.5 } });
      map.addLayer({ id: "pivot-handles", type: "circle", source: "pivot-handles",
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "center"], 9, 7],
          // center white, radius blue, arc start green / end red,
          // skip-wedge handles orange (subtractive)
          "circle-color": ["match", ["get", "kind"],
            "center", "#ffffff", "radius", "#38bdf8", "start", "#4ade80",
            "skip", "#fb923c", "#f87171"],
          "circle-stroke-color": "#0c4a6e",
          "circle-stroke-width": 2,
        } });

      const beginPivotDrag = (role: string) => {
        map.dragPan.disable();
        const onMove = (ev: mapboxgl.MapMouseEvent | mapboxgl.MapTouchEvent) => {
          applyPivotDragRef.current(role, [ev.lngLat.lng, ev.lngLat.lat]);
        };
        const end = () => {
          map.off("mousemove", onMove);
          map.off("touchmove", onMove);
          map.dragPan.enable();
        };
        map.on("mousemove", onMove);
        map.on("touchmove", onMove);
        map.once("mouseup", end);
        map.once("touchend", end);
      };
      map.on("mousedown", "pivot-handles", (e) => {
        if (!pivotEditRef.current) return;
        e.preventDefault();
        beginPivotDrag(String(e.features?.[0]?.properties?.role ?? ""));
      });
      map.on("touchstart", "pivot-handles", (e) => {
        if (!pivotEditRef.current) return;
        e.preventDefault();
        beginPivotDrag(String(e.features?.[0]?.properties?.role ?? ""));
      });

      setMapLoaded(true);
    });

    map.on("click", (e) => clickRef.current(e));
    for (const layer of [
      "properties-fill", "parcels-fill", "fields-fill", "pastures-fill",
      "timber-fill", "roads-hit", "assets-circle", "assets-line", "assets-fill",
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
      drawingShapeRef.current(false);
      if (pivotCutoutRef.current && geometry.type === "Polygon") {
        // Exclusion cutout drawn inside the pivot editor.
        addPivotCutoutRef.current(geometry);
        return;
      }
      if (splitTargetRef.current && geometry.type === "LineString") {
        applySplitRef.current(geometry);
        return;
      }
      if (boundaryOpRef.current) {
        applyBoundaryOpRef.current(geometry, String(e.features[0].id ?? ""));
        return;
      }
      if (editTargetRef.current) {
        saveEditedRef.current();
        return;
      }
      // First completed shape of a new-boundary session stays on the
      // canvas; remember it so Discard shape never removes it.
      completedDrawIdsRef.current.add(String(e.features[0].id ?? ""));
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

    // Properties carry their entity's color for the color-by-entity mode
    const entityIndex = new Map(entities.map((e, i) => [e.id, i]));
    const propertiesFC = rowsToFC(properties, "property");
    for (const feature of propertiesFC.features) {
      const row = properties.find((p) => p.id === feature.properties?.id);
      if (row?.entity_id !== null && row?.entity_id !== undefined) {
        const idx = entityIndex.get(row.entity_id);
        if (idx !== undefined) {
          feature.properties = {
            ...feature.properties,
            entityColor: entityColor(idx),
          };
        }
      }
    }
    setData("properties", propertiesFC);
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
    setData("pastures", rowsToFC(pastures, "pasture"));
    setData("timber", rowsToFC(timber, "timber_stand"));
    setData("roads", rowsToFC(roads, "road"));
    setData("assets", rowsToFC(assets, "asset"));
    setData("property-labels", rowsToLabelFC(properties, "property"));
    setData("parcel-labels", rowsToLabelFC(parcels, "parcel"));
    setData("field-labels", rowsToLabelFC(fields, "field"));
    setData("pasture-labels", rowsToLabelFC(pastures, "pasture"));
    setData("timber-labels", rowsToLabelFC(timber, "timber_stand"));

    if (!didFitRef.current) {
      const box = bboxOf([
        ...properties.map(geomOf), ...parcels.map(geomOf), ...fields.map(geomOf),
        ...pastures.map(geomOf), ...timber.map(geomOf), ...roads.map(geomOf),
        ...assets.map(geomOf),
      ]);
      if (box) {
        map.fitBounds(box, { padding: 60, duration: 0 });
        didFitRef.current = true;
      }
    }
  }, [mapLoaded, properties, parcels, fields, pastures, timber, roads, assets, farmActivity, entities]);

  // Color-by-entity toggle: recolor property outlines by holding entity
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !map.getLayer("properties-line")) return;
    if (entityColorsOn) {
      map.setPaintProperty("properties-line", "line-color", [
        "coalesce",
        ["get", "entityColor"],
        "#ffffff",
      ]);
      map.setPaintProperty("properties-line", "line-width", 3);
      map.setPaintProperty("properties-fill", "fill-color", [
        "coalesce",
        ["get", "entityColor"],
        "#ffffff",
      ]);
      map.setPaintProperty("properties-fill", "fill-opacity", 0.08);
    } else {
      map.setPaintProperty("properties-line", "line-color", "#ffffff");
      map.setPaintProperty("properties-line", "line-width", 2.5);
      map.setPaintProperty("properties-fill", "fill-color", "#ffffff");
      map.setPaintProperty("properties-fill", "fill-opacity", 0.05);
    }
  }, [entityColorsOn, mapLoaded, entities]);

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
      ["pasture", ["pastures-fill", "pastures-line", "pasture-labels"]],
      ["timber_stand", ["timber-fill", "timber-line", "timber-labels"]],
      ["road", ["roads-casing", "roads-line", "roads-hit", "road-labels"]],
      ["asset", ["assets-fill", "assets-outline", "assets-line", "assets-circle", "assets-letter", "assets-name", "pivot-circles-fill", "pivot-circles-line"]],
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
      properties: "", parcels: "", fields: "", pastures: "", timber: "",
      roads: "", assets: "",
    };
    if (selected) {
      const srcName: Record<EntityType, string> = {
        property: "properties", parcel: "parcels", field: "fields",
        pasture: "pastures", timber_stand: "timber", road: "roads",
        asset: "assets",
      };
      bySource[srcName[selected.entityType]] = selected.id;
    }
    for (const src of ["properties", "parcels", "fields", "pastures", "timber"]) {
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
    splitTargetRef.current = null;
    boundaryOpRef.current = null;
    setPendingExtraDraw(false);
    setEditTargetType(null);
    setDrawingShape(false);
    completedDrawIdsRef.current = new Set();
    placeForPivotRef.current = false;
  }

  // Session-level cancel: when completed areas exist, a mis-tap must not
  // destroy minutes of tracing.
  function cancelBoundarySession() {
    const parts = pendingPolyRef.current?.coordinates.length ?? 0;
    if (
      parts > 0 &&
      !window.confirm(`Discard ${parts} drawn area${parts === 1 ? "" : "s"}?`)
    ) {
      return;
    }
    resetDrawState();
  }

  function handleToolbarCancel() {
    if (pendingPolyRef.current && drawKindRef.current === "boundary") {
      cancelBoundarySession();
    } else {
      resetDrawState();
    }
  }

  // Shape-level discard (Escape or the Discard shape button): removes
  // ONLY the in-progress polygon. Completed areas, the save form, and
  // the session all stay.
  const discardShapeRef = useRef<() => void>(() => {});
  discardShapeRef.current = () => {
    const draw = drawRef.current;
    if (!draw) return;
    const keep = completedDrawIdsRef.current;
    for (const f of draw.getAll().features) {
      if (!keep.has(String(f.id))) draw.delete(String(f.id));
    }
    if (boundaryOpRef.current) {
      boundaryOpRef.current = null;
      if (editTargetRef.current) {
        const kept = draw.getAll().features[0];
        if (kept) draw.changeMode("direct_select", { featureId: String(kept.id) });
        setEditHint("Drag the points to adjust, add or cut more, then press Save.");
        setDrawingShape(false);
      } else {
        // Back to the save dialog with completed areas intact.
        setPendingExtraDraw(false);
        setDrawingShape(false);
      }
    } else if (modeRef.current === "draw" && drawKindRef.current) {
      // Still tracing the first shape: clear it and keep drawing.
      if (drawKindRef.current === "line") draw.changeMode("draw_line_string");
      else draw.changeMode("draw_polygon");
      setDrawingShape(true);
    } else {
      setDrawingShape(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || modeRef.current === "view") return;
      const drawMode = drawRef.current?.getMode() ?? "";
      if (String(drawMode).startsWith("draw_")) {
        e.preventDefault();
        discardShapeRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Add/cut an area with a drawn polygon ----

  function startBoundaryOp(op: "add" | "subtract") {
    const draw = drawRef.current;
    if (!draw) return;
    boundaryOpRef.current = op;
    if (!editTargetRef.current) setPendingExtraDraw(true);
    setDrawingShape(true);
    setEditHint(
      op === "add"
        ? "Draw the area to add (it does not need to touch). Double tap the last point to finish."
        : "Draw the area to cut out. Double tap the last point to finish."
    );
    draw.changeMode("draw_polygon");
  }

  const applyBoundaryOpRef = useRef<(g: Geometry, drawnId: string) => void>(
    () => {}
  );
  applyBoundaryOpRef.current = (geometry, drawnId) => {
    const op = boundaryOpRef.current;
    boundaryOpRef.current = null;
    const draw = drawRef.current;
    const drawn = toMultiPolygon(geometry);
    if (!draw || !op || !drawn) return;

    const asFeature = (g: MultiPolygon): Feature<MultiPolygon> => ({
      type: "Feature",
      properties: {},
      geometry: g,
    });
    const combine = (base: MultiPolygon | null): MultiPolygon | null => {
      if (!base) return op === "add" ? drawn : null;
      const result =
        op === "add"
          ? turfUnion({
              type: "FeatureCollection",
              features: [asFeature(base), asFeature(drawn)],
            })
          : turfDifference({
              type: "FeatureCollection",
              features: [asFeature(base), asFeature(drawn)],
            });
      return result ? toMultiPolygon(result.geometry) : null;
    };

    if (editTargetRef.current) {
      // Editing a saved boundary: combine with everything already on
      // the draw canvas except the polygon just drawn.
      const parts: MultiPolygon["coordinates"] = [];
      for (const f of draw.getAll().features) {
        if (String(f.id) === drawnId) continue;
        const mp = toMultiPolygon(f.geometry);
        if (mp) parts.push(...mp.coordinates);
      }
      const base: MultiPolygon | null =
        parts.length > 0 ? { type: "MultiPolygon", coordinates: parts } : null;
      const combined = combine(base);
      if (!combined) {
        setSaveError("That cut would remove the whole boundary.");
        draw.delete(drawnId);
        return;
      }
      draw.deleteAll();
      const ids = draw.add(asFeature(combined));
      completedDrawIdsRef.current = new Set(ids.map(String));
      draw.changeMode("direct_select", { featureId: ids[0] });
      setSaveError(null);
      setEditHint("Drag the points to adjust, add or cut more, then press Save.");
    } else {
      // Building a NEW boundary: fold into the pending shape and bring
      // the save dialog back.
      const combined = combine(pendingPolyRef.current);
      if (!combined) {
        setSaveError("That cut would remove the whole boundary.");
        draw.delete(drawnId);
        setPendingExtraDraw(false);
        return;
      }
      draw.deleteAll();
      const ids = draw.add(asFeature(combined));
      completedDrawIdsRef.current = new Set(ids.map(String));
      setPendingPoly(combined);
      setSaveError(null);
      setPendingExtraDraw(false);
    }
  };

  // ---- Pivot coverage circle editor ----

  // Finish drawing an exclusion cutout: store it and return to handles.
  const addPivotCutoutRef = useRef<(polygon: Polygon) => void>(() => {});
  addPivotCutoutRef.current = (polygon: Polygon) => {
    pivotCutoutRef.current = false;
    setDrawingCutout(false);
    drawRef.current?.deleteAll();
    setPivotEdit((edit) =>
      edit
        ? { ...edit, params: { ...edit.params, cutouts: [...edit.params.cutouts, polygon] } }
        : edit
    );
  };

  function startPivotCutout() {
    const draw = drawRef.current;
    if (!draw) return;
    pivotCutoutRef.current = true;
    setDrawingCutout(true);
    draw.changeMode("draw_polygon");
  }

  const applyPivotDragRef = useRef<(role: string, lngLat: [number, number]) => void>(
    () => {}
  );
  applyPivotDragRef.current = (role, lngLat) => {
    // Base drags on a position (the base circle or a towable position).
    const dragPosition = (pos: PivotPosition, sub: string): PivotPosition => {
      if (sub === "center") return { ...pos, center: lngLat };
      if (sub === "radius") {
        return { ...pos, radiusFt: Math.max(50, Math.round(distanceFt(pos.center, lngLat))) };
      }
      if (sub === "start" && pos.endBearingDeg !== null) {
        // Snap so the SWEEP lands on 90/180/270 within ~3 degrees.
        let bearing = bearingTo(pos.center, lngLat);
        for (const target of [90, 180, 270]) {
          if (Math.abs(sweepDegrees(bearing, pos.endBearingDeg) - target) <= 3) {
            bearing = (pos.endBearingDeg - target + 360) % 360;
            break;
          }
        }
        return { ...pos, startBearingDeg: Math.round(bearing * 10) / 10 };
      }
      if (sub === "end" && pos.startBearingDeg !== null) {
        const bearing = snapEndBearing(pos.startBearingDeg, bearingTo(pos.center, lngLat));
        return { ...pos, endBearingDeg: Math.round(bearing * 10) / 10 };
      }
      return pos;
    };
    setPivotEdit((edit) => {
      if (!edit) return edit;
      const p = edit.params;
      const parts = role.split(":");
      if (parts[0] === "ext") {
        const i = Number(parts[1]);
        const zone = p.extensions[i];
        if (!zone) return edit;
        const next = { ...zone };
        if (parts[2] === "radius") {
          next.outerRadiusFt = Math.max(
            p.radiusFt + 10,
            Math.round(distanceFt(p.center, lngLat))
          );
        } else {
          const bearing = Math.round(bearingTo(p.center, lngLat) * 10) / 10;
          if (parts[2] === "start") next.startBearingDeg = bearing;
          else next.endBearingDeg = bearing;
        }
        const extensions = p.extensions.map((z, j) => (j === i ? next : z));
        return { ...edit, params: { ...p, extensions } };
      }
      if (parts[0] === "skip") {
        const i = Number(parts[1]);
        const zone = p.skips[i];
        if (!zone) return edit;
        const bearing = Math.round(bearingTo(p.center, lngLat) * 10) / 10;
        const next =
          parts[2] === "start"
            ? { ...zone, startBearingDeg: bearing }
            : { ...zone, endBearingDeg: bearing };
        const skips = p.skips.map((z, j) => (j === i ? next : z));
        return { ...edit, params: { ...p, skips } };
      }
      if (parts[0] === "pos") {
        const i = Number(parts[1]);
        const pos = p.positions[i];
        if (!pos) return edit;
        const positions = p.positions.map((q, j) =>
          j === i ? dragPosition(q, parts[2]) : q
        );
        return { ...edit, params: { ...p, positions } };
      }
      return { ...edit, params: { ...p, ...dragPosition(p, role) } };
    });
  };

  // Preview + handle sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    const preview = map.getSource("pivot-preview") as GeoJSONSource | undefined;
    const handles = map.getSource("pivot-handles") as GeoJSONSource | undefined;
    if (!pivotEdit) {
      preview?.setData(empty);
      handles?.setData(empty);
      return;
    }
    const p = pivotEdit.params;
    // Live preview is the PLANTABLE shape: cutout holes punch through.
    preview?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: compositePivotGeometry(p).plantable,
        },
      ],
    });
    const handleFeatures: Feature[] = [];
    const at = (
      center: [number, number],
      radiusFt: number,
      bearing: number
    ): [number, number] =>
      pivotDestination(center, radiusFt * 0.3048, bearing) as [number, number];
    const positionHandles = (pos: PivotPosition, prefix: string) => {
      const midBearing = pos.fullCircle
        ? 90
        : (pos.startBearingDeg! +
            sweepDegrees(pos.startBearingDeg!, pos.endBearingDeg!) / 2) %
          360;
      handleFeatures.push(
        { type: "Feature", properties: { role: `${prefix}center`, kind: "center" },
          geometry: { type: "Point", coordinates: pos.center } },
        { type: "Feature", properties: { role: `${prefix}radius`, kind: "radius" },
          geometry: { type: "Point", coordinates: at(pos.center, pos.radiusFt, midBearing) } }
      );
      if (!pos.fullCircle && pos.startBearingDeg !== null && pos.endBearingDeg !== null) {
        handleFeatures.push(
          { type: "Feature", properties: { role: `${prefix}start`, kind: "start" },
            geometry: { type: "Point", coordinates: at(pos.center, pos.radiusFt, pos.startBearingDeg) } },
          { type: "Feature", properties: { role: `${prefix}end`, kind: "end" },
            geometry: { type: "Point", coordinates: at(pos.center, pos.radiusFt, pos.endBearingDeg) } }
        );
      }
    };
    positionHandles(p, "");
    p.positions.forEach((pos, i) => positionHandles(pos, `pos:${i}:`));
    p.extensions.forEach((z, i) => {
      const mid =
        (z.startBearingDeg + sweepDegrees(z.startBearingDeg, z.endBearingDeg) / 2) % 360;
      handleFeatures.push(
        { type: "Feature", properties: { role: `ext:${i}:start`, kind: "start" },
          geometry: { type: "Point", coordinates: at(p.center, z.outerRadiusFt, z.startBearingDeg) } },
        { type: "Feature", properties: { role: `ext:${i}:end`, kind: "end" },
          geometry: { type: "Point", coordinates: at(p.center, z.outerRadiusFt, z.endBearingDeg) } },
        { type: "Feature", properties: { role: `ext:${i}:radius`, kind: "radius" },
          geometry: { type: "Point", coordinates: at(p.center, z.outerRadiusFt, mid) } }
      );
    });
    p.skips.forEach((z, i) => {
      handleFeatures.push(
        { type: "Feature", properties: { role: `skip:${i}:start`, kind: "skip" },
          geometry: { type: "Point", coordinates: at(p.center, p.radiusFt, z.startBearingDeg) } },
        { type: "Feature", properties: { role: `skip:${i}:end`, kind: "skip" },
          geometry: { type: "Point", coordinates: at(p.center, p.radiusFt, z.endBearingDeg) } }
      );
    });
    handles?.setData({ type: "FeatureCollection", features: handleFeatures });
  }, [pivotEdit, mapLoaded]);

  function startPivotEditor() {
    const map = mapRef.current;
    const row = selectedRow as AssetGeo | null;
    if (!map || !row || !selected || selected.entityType !== "asset") return;
    const details = (row.details ?? {}) as Record<string, unknown>;
    if (details.custom_shape === true) return; // one-way: vertex editing only
    let params = compositeFromDetails(details);
    if (!params) {
      const g = row.geom_geojson;
      const center: [number, number] =
        g?.type === "Point"
          ? (g.coordinates as [number, number])
          : [map.getCenter().lng, map.getCenter().lat];
      const wetted = Number(details.wetted_length_ft);
      params = {
        center,
        radiusFt: wetted > 0 ? wetted : 1300,
        fullCircle: true,
        startBearingDeg: null,
        endBearingDeg: null,
        extensions: [],
        skips: [],
        cutouts: [],
        positions: [],
      };
    }
    setSelected(null);
    setSaveError(null);
    setMode("pivot");
    setPivotEdit({ assetId: row.id, params });
    const box = bboxOf([compositePivotGeometry(params).watered]);
    if (box) map.fitBounds(box, { padding: 100, duration: 300 });
  }

  function cancelPivotEditor() {
    setPivotEdit(null);
    setPendingPivotSave(false);
    pivotCutoutRef.current = false;
    setDrawingCutout(false);
    setMode("view");
    setSaveError(null);
  }

  // Derived geometry + stored details for a composite pivot: the saved
  // polygon is the PLANTABLE shape (cutout holes punched through);
  // acres_covered (headline) = plantable, acres_watered = gross.
  function pivotDerived(p: CompositePivotParams, existing: Record<string, unknown> = {}) {
    const geo = compositePivotGeometry(p);
    return {
      geometry: geo.plantable,
      grossAcres: geo.grossAcres,
      plantableAcres: geo.plantableAcres,
      details: {
        ...existing,
        ...detailsFromComposite(p),
        acres_covered: Math.round(geo.plantableAcres * 10) / 10,
        acres_watered: Math.round(geo.grossAcres * 10) / 10,
      },
    };
  }

  // One-way escape hatch: freeze the generated polygon as ordinary
  // vertex-editable geometry for machines the parameters cannot express.
  async function convertPivotToCustomShape() {
    const edit = pivotEditRef.current;
    if (!edit || edit.assetId === null) return;
    if (
      !window.confirm(
        "Convert to a custom shape? The circle handles go away for good; you edit the outline point by point from then on."
      )
    ) {
      return;
    }
    const asset = assets.find((a) => a.id === edit.assetId);
    const derived = pivotDerived(
      edit.params,
      (asset?.details ?? {}) as Record<string, unknown>
    );
    setSaving(true);
    const { error: dErr } = await supabase
      .from("assets")
      .update({ details: { ...derived.details, custom_shape: true } })
      .eq("id", edit.assetId);
    const gErr = dErr
      ? null
      : await applyGeometry({ entityType: "asset", id: edit.assetId }, derived.geometry);
    setSaving(false);
    if (dErr || gErr) {
      setSaveError("Could not convert. " + (dErr?.message ?? gErr?.message ?? ""));
      return;
    }
    const sel: SelectedFeature = { entityType: "asset", id: edit.assetId };
    cancelPivotEditor();
    await loadData();
    setSelected(sel);
  }

  // Save from the Add-menu flow: the circle is drawn, now name it and
  // pick a property (suggested from the center's location), then insert
  // the asset with its parameters and derived polygon.
  async function saveNewPivot(payload: NewAssetPayload) {
    const edit = pivotEditRef.current;
    if (!edit) return;
    setSaving(true);
    setSaveError(null);
    const derived = pivotDerived(edit.params);
    const sel = await insertAndSetGeometry(
      "assets",
      {
        organization_id: orgId,
        property_id: payload.propertyId,
        name: payload.name,
        asset_type: "irrigation_pivot",
        details: derived.details,
      },
      "asset",
      derived.geometry
    );
    setSaving(false);
    if (sel) {
      cancelPivotEditor();
      await loadData();
      setSelected(sel);
    }
  }

  async function savePivot() {
    const edit = pivotEditRef.current;
    if (!edit) return;
    if (edit.assetId === null) {
      // New pivot: collect name and property first.
      setPendingPivotSave(true);
      return;
    }
    const p = edit.params;
    const asset = assets.find((a) => a.id === edit.assetId);
    const derived = pivotDerived(p, (asset?.details ?? {}) as Record<string, unknown>);
    const polygon = derived.geometry;
    const details = derived.details;
    setSaving(true);
    const { error: dErr } = await supabase
      .from("assets")
      .update({ details })
      .eq("id", edit.assetId);
    const gErr = dErr
      ? null
      : await applyGeometry({ entityType: "asset", id: edit.assetId }, polygon);
    setSaving(false);
    if (dErr || gErr) {
      setSaveError("Could not save the circle. " + (dErr?.message ?? gErr?.message ?? ""));
      return;
    }
    const sel: SelectedFeature = { entityType: "asset", id: edit.assetId };
    cancelPivotEditor();
    await loadData();
    setSelected(sel);
  }

  // ---- Split a saved timber stand with a drawn line ----
  const splitTargetRef = useRef<SelectedFeature | null>(null);

  function startSplitStand() {
    const draw = drawRef.current;
    if (!draw || !selected || selected.entityType !== "timber_stand") return;
    splitTargetRef.current = selected;
    setSelected(null);
    setSaveError(null);
    setMode("split");
    setEditHint(
      "Draw a line all the way across the stand. Double tap the last point to finish."
    );
    draw.deleteAll();
    draw.changeMode("draw_line_string");
  }

  const applySplitRef = useRef<(line: Geometry) => void>(() => {});
  applySplitRef.current = async (line: Geometry) => {
    const target = splitTargetRef.current;
    if (!target || line.type !== "LineString") return;
    const stand = timber.find((t) => t.id === target.id);
    const shape = stand?.boundary_geojson;
    if (!stand || !shape) {
      resetDrawState();
      return;
    }
    // Subtract a hair-thin buffer of the line; each remaining part
    // becomes its own stand.
    const blade = turfBuffer(
      { type: "Feature", properties: {}, geometry: line },
      0.0005,
      { units: "kilometers" }
    );
    const remainder = blade
      ? turfDifference({
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: shape },
            blade,
          ],
        })
      : null;
    const parts: MultiPolygon["coordinates"] =
      remainder?.geometry.type === "MultiPolygon"
        ? remainder.geometry.coordinates
        : remainder?.geometry.type === "Polygon"
          ? [remainder.geometry.coordinates]
          : [];
    if (parts.length < 2) {
      setSaveError("The line did not cross the whole stand; nothing was split.");
      drawRef.current?.deleteAll();
      drawRef.current?.changeMode("draw_line_string");
      return;
    }
    const acresOfPart = (c: MultiPolygon["coordinates"][number]) =>
      turfArea({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: c },
      }) / 4046.8564224;
    const ordered = [...parts].sort((a, b) => acresOfPart(b) - acresOfPart(a));
    if (
      !window.confirm(
        `Split "${stand.name}" into ${ordered.length} stands (about ${ordered
          .map((p) => acresOfPart(p).toFixed(1))
          .join(" and ")} acres)? Stand info is copied to the new stand${ordered.length > 2 ? "s" : ""}.`
      )
    ) {
      resetDrawState();
      return;
    }
    setSaving(true);
    const failures: string[] = [];
    const largest: Geometry = { type: "Polygon", coordinates: ordered[0] };
    const gErr = await applyGeometry(target, largest);
    if (gErr) failures.push(gErr.message);
    for (let i = 1; i < ordered.length; i++) {
      const { data, error } = await supabase
        .from("timber_stands")
        .insert({
          organization_id: orgId,
          property_id: stand.property_id,
          name: `${stand.name} (${i + 1})`,
          stand_type: stand.stand_type,
          species: stand.species,
          year_established: stand.year_established,
          site_index: stand.site_index,
          last_thinning_year: stand.last_thinning_year,
          last_burn_year: stand.last_burn_year,
          notes: stand.notes,
        })
        .select("id")
        .single();
      if (error || !data) {
        failures.push(error?.message ?? "insert failed");
        continue;
      }
      const gErr2 = await applyGeometry(
        { entityType: "timber_stand", id: data.id },
        { type: "Polygon", coordinates: ordered[i] }
      );
      if (gErr2) failures.push(gErr2.message);
    }
    setSaving(false);
    if (failures.length > 0) {
      setSaveError("Split problems: " + failures.slice(0, 2).join("; "));
      return;
    }
    const sel = { ...target };
    resetDrawState();
    await loadData();
    setSelected(sel);
  };

  function startAdd(kind: "boundary" | "line" | "asset_point" | "pivot") {
    const draw = drawRef.current;
    if (!draw) return;
    setAddMenuOpen(false);
    setSelected(null);
    setSaveError(null);
    editTargetRef.current = null;
    if (kind === "asset_point" || kind === "pivot") {
      placeForPivotRef.current = kind === "pivot";
      setCrosshairPos(null);
      setMode("place");
      setEditHint(
        kind === "pivot"
          ? "Pan the map or drag the crosshair onto the pivot point, then press Place here."
          : "Pan the map or drag the crosshair to line it up, then press Place here."
      );
      return;
    }
    drawKindRef.current = kind;
    setMode("draw");
    draw.deleteAll();
    completedDrawIdsRef.current = new Set();
    setDrawingShape(true);
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

    setEditTargetType(selected.entityType);
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
      setCrosshairPos(null);
      setMode("place");
      setEditHint("Pan the map or drag the crosshair, then press Place here.");
      return;
    }

    setMode("edit");
    draw.deleteAll();
    completedDrawIdsRef.current = new Set();
    if (g) {
      const ids = draw.add({ type: "Feature", geometry: g, properties: {} });
      completedDrawIdsRef.current = new Set(ids.map(String));
      draw.changeMode("direct_select", { featureId: ids[0] });
      setEditHint("Drag the points to adjust, then press Save.");
    } else if (isLineTarget || selected.entityType === "road") {
      draw.changeMode("draw_line_string");
      setDrawingShape(true);
      setEditHint("No line yet. Draw one; it saves when you finish.");
    } else {
      draw.changeMode("draw_polygon");
      setDrawingShape(true);
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
    // Wherever the crosshair sits: its dragged position, else center.
    const pos = crosshairPosRef.current;
    const center = pos ? map.unproject([pos.x, pos.y]) : map.getCenter();
    if (placeForPivotRef.current) {
      // The crosshair placed a NEW pivot's center: straight into the
      // circle editor (Save asks for name and property).
      placeForPivotRef.current = false;
      setMode("pivot");
      setPivotEdit({
        assetId: null,
        params: {
          center: [center.lng, center.lat],
          radiusFt: 1300,
          fullCircle: true,
          startBearingDeg: null,
          endBearingDeg: null,
          extensions: [],
          skips: [],
          cutouts: [],
          positions: [],
        },
      });
      return;
    }
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
        setCrosshairPos(null); // GPS point lands under the crosshair
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
      if (payload.entityType === "timber_stand") {
        // Stand details captured inline in the save dialog: the stand
        // saves complete in one step.
        base.stand_type = payload.standType;
        base.species = payload.species;
        base.year_established = payload.yearEstablished;
        base.notes = payload.standNotes;
      }
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
    } else if (payload.kind === "irrigation_lateral") {
      // The drawn line is the travel path; coverage is the path swept
      // by the machine length (flat ends), saved as the geometry with
      // the path kept in details for regeneration.
      const path = [...pendingLine.coordinates].sort((a, b) => b.length - a.length)[0];
      const derived = payload.machineLengthFt
        ? lateralGeometry(path, payload.machineLengthFt, [])
        : null;
      if (!derived) {
        setSaving(false);
        setSaveError("Enter the machine length in feet.");
        return;
      }
      sel = await insertAndSetGeometry(
        "assets",
        {
          organization_id: orgId,
          property_id: payload.propertyId,
          name: payload.name,
          asset_type: "irrigation_lateral",
          details: {
            length_ft: Math.round(payload.machineLengthFt!),
            path,
            acres_covered: Math.round(derived.plantableAcres * 10) / 10,
            acres_watered: Math.round(derived.grossAcres * 10) / 10,
          },
        },
        "asset",
        derived.plantable
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

  // Which property contains the drawn geometry: preselected in the save
  // dialogs (the user confirms or changes it), same logic as the file
  // import's suggestions.
  const matchableProperties = useMemo(
    () => properties.map((p) => ({ id: p.id, boundary: p.boundary_geojson })),
    [properties]
  );
  const suggestedForPoly = pendingPoly
    ? suggestPropertyId(pendingPoly, matchableProperties)
    : null;
  const suggestedForLine = pendingLine
    ? suggestPropertyId(pendingLine, matchableProperties)
    : null;
  const suggestedForPoint = pendingPoint
    ? suggestPropertyId(
        { type: "Point", coordinates: pendingPoint },
        matchableProperties
      )
    : null;

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

      {/* Crosshair for placement: pans-under AND draggable (generous
          hit area for thumbs). Place here confirms where it sits. */}
      {showCrosshair ? (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className="pointer-events-auto absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
            style={
              crosshairPos
                ? { left: crosshairPos.x, top: crosshairPos.y }
                : { left: "50%", top: "50%" }
            }
            onPointerDown={(e) => {
              crosshairDragRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              e.preventDefault();
            }}
            onPointerMove={crosshairPointerMove}
            onPointerUp={() => {
              crosshairDragRef.current = false;
            }}
            onPointerCancel={() => {
              crosshairDragRef.current = false;
            }}
          >
            <svg viewBox="0 0 48 48" className="h-12 w-12 drop-shadow">
              <circle cx="24" cy="24" r="10" fill="none" stroke="#ffffff" strokeWidth="2.5" />
              <circle cx="24" cy="24" r="2.5" fill={KELLY} />
              <path d="M24 2v10M24 36v10M2 24h10M36 24h10" stroke="#ffffff" strokeWidth="2.5" />
            </svg>
          </div>
        </div>
      ) : null}

      {/* Left control column */}
      <div className="absolute left-3 top-3 z-20 flex w-36 flex-col gap-2">
        <LayerToggle visibility={visibility} onChange={setVisibility} />
        {visibility.timber_stand && timber.length > 0 ? (
          <div className="rounded-lg bg-white/95 p-2 shadow-md">
            <p className="text-xs font-medium text-gray-800">Timber types</p>
            <div className="mt-1 space-y-0.5">
              {Object.keys(STAND_TYPE_LABELS)
                .filter((type) =>
                  timber.some(
                    (t) => ((t as TimberStandGeo).stand_type ?? "other") === type
                  )
                )
                .map((type) => (
                  <p key={type} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <span
                      className="h-3 w-3 rounded-[2px] border border-gray-300"
                      style={{ background: STAND_TYPE_COLORS[type] }}
                    />
                    {STAND_TYPE_LABELS[type]}
                  </p>
                ))}
            </div>
          </div>
        ) : null}
        {entities.length > 1 ? (
          <div className="rounded-lg bg-white/95 p-2 shadow-md">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={entityColorsOn}
                onChange={(e) => setEntityColorsOn(e.target.checked)}
                className="h-4 w-4 accent-kelly-500"
              />
              By entity
            </label>
            {entityColorsOn ? (
              <div className="mt-1 space-y-0.5">
                {entities.map((entity, i) => (
                  <p key={entity.id} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <span
                      className="h-3 w-3 shrink-0 rounded-[2px] border border-gray-300"
                      style={{ background: entityColor(i) }}
                    />
                    <span className="truncate">{entity.name}</span>
                  </p>
                ))}
                <p className="flex items-center gap-1.5 text-xs text-gray-700">
                  <span className="h-3 w-3 shrink-0 rounded-[2px] border border-gray-300 bg-white" />
                  No entity
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
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
                    ["pivot", "Irrigation pivot (circle)"],
                  ] as Array<["boundary" | "line" | "asset_point" | "pivot", string]>
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

      {/* Pivot coverage circle toolbar (hidden while the new-pivot save
          dialog is up so the two never overlap) */}
      {mode === "pivot" && pivotEdit && !pendingPivotSave
        ? (() => {
            const p = pivotEdit.params;
            const geo = compositePivotGeometry(p);
            const setParams = (patch: Partial<CompositePivotParams>) =>
              setPivotEdit((edit) =>
                edit ? { ...edit, params: { ...edit.params, ...patch } } : edit
              );
            const hasCutouts = p.cutouts.length > 0;
            const chipClass =
              "flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-xs";
            const addClass =
              "rounded bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25";
            return (
              <div className="absolute inset-x-0 top-3 z-20 mx-auto w-fit max-w-[94%] rounded-lg bg-pine-900/95 px-3 py-2 text-white shadow-lg">
                {drawingCutout ? (
                  <>
                    <p className="text-xs">
                      Draw the cutout (pond, road, rock) on the map; double tap
                      the last point to finish. It cuts a hole in the coverage.
                    </p>
                    <div className="mt-1.5 flex justify-center">
                      <button
                        onClick={() => {
                          pivotCutoutRef.current = false;
                          setDrawingCutout(false);
                          drawRef.current?.deleteAll();
                        }}
                        className={addClass}
                      >
                        Cancel cutout
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs">
                      White handle moves, blue is a radius, green/red are arc
                      edges, orange are skip wedges.
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
                      <label className="flex items-center gap-1 text-xs">
                        Radius
                        <input
                          type="number"
                          value={Math.round(p.radiusFt)}
                          onChange={(e) =>
                            setParams({ radiusFt: Math.max(50, Number(e.target.value) || 50) })
                          }
                          className="w-20 rounded border-0 px-1.5 py-0.5 text-xs text-gray-900"
                          title="Wetted length in feet; end gun sectors get their own zones"
                        />
                        ft
                      </label>
                      <span className="flex overflow-hidden rounded border border-white/30">
                        {[true, false].map((full) => (
                          <button
                            key={String(full)}
                            onClick={() =>
                              setParams({
                                fullCircle: full,
                                startBearingDeg: full ? null : (p.startBearingDeg ?? 0),
                                endBearingDeg: full ? null : (p.endBearingDeg ?? 180),
                              })
                            }
                            className={
                              "px-2 py-0.5 text-xs font-semibold " +
                              (p.fullCircle === full
                                ? "bg-kelly-500"
                                : "bg-transparent hover:bg-white/15")
                            }
                          >
                            {full ? "Full circle" : "Partial circle"}
                          </button>
                        ))}
                      </span>
                      <span className="text-xs tabular-nums">
                        {hasCutouts
                          ? `${formatAcres(geo.plantableAcres)} plantable of ${formatAcres(geo.grossAcres)} watered`
                          : `${formatAcres(geo.grossAcres)} ac`}
                        {p.fullCircle
                          ? ""
                          : ` · ${Math.round(
                              sweepDegrees(p.startBearingDeg ?? 0, p.endBearingDeg ?? 0)
                            )}° sweep`}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                      <button
                        onClick={() =>
                          setParams({
                            extensions: [
                              ...p.extensions,
                              {
                                startBearingDeg: 315,
                                endBearingDeg: 45,
                                outerRadiusFt: Math.round(p.radiusFt + 90),
                              },
                            ],
                          })
                        }
                        title="End gun sector, corner arm lobe, or bender reach: a sector at a longer radius"
                        className={addClass}
                      >
                        + Extension
                      </button>
                      <button
                        onClick={() =>
                          setParams({
                            skips: [...p.skips, { startBearingDeg: 80, endBearingDeg: 110 }],
                          })
                        }
                        title="A wedge never watered (barn, pond, road wrap)"
                        className={addClass}
                      >
                        + Skip
                      </button>
                      <button
                        onClick={startPivotCutout}
                        title="Draw a small polygon that cuts a hole (watered but not plantable)"
                        className={addClass}
                      >
                        + Cutout
                      </button>
                      <button
                        onClick={() =>
                          setParams({
                            positions: [
                              ...p.positions,
                              {
                                center: pivotDestination(
                                  p.center,
                                  p.radiusFt * 0.3048 * 2.2,
                                  90
                                ) as [number, number],
                                radiusFt: p.radiusFt,
                                fullCircle: true,
                                startBearingDeg: null,
                                endBearingDeg: null,
                                extensions: [],
                                skips: [],
                              },
                            ],
                          })
                        }
                        title="Towable pivot: another position for the same machine"
                        className={addClass}
                      >
                        + Position
                      </button>
                      {pivotEdit.assetId !== null ? (
                        <button
                          onClick={convertPivotToCustomShape}
                          title="One-way: freeze the shape for point-by-point editing"
                          className={addClass}
                        >
                          Convert to custom shape
                        </button>
                      ) : null}
                    </div>
                    {p.extensions.length + p.skips.length + p.cutouts.length + p.positions.length >
                    0 ? (
                      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                        {p.extensions.map((z, i) => (
                          <span key={`e${i}`} className={chipClass}>
                            Ext {i + 1}: {Math.round(z.outerRadiusFt)} ft
                            <input
                              type="number"
                              value={Math.round(z.outerRadiusFt)}
                              onChange={(e) =>
                                setParams({
                                  extensions: p.extensions.map((q, j) =>
                                    j === i
                                      ? {
                                          ...q,
                                          outerRadiusFt: Math.max(
                                            p.radiusFt + 10,
                                            Number(e.target.value) || 0
                                          ),
                                        }
                                      : q
                                  ),
                                })
                              }
                              className="w-16 rounded border-0 px-1 py-0 text-xs text-gray-900"
                            />
                            <button
                              onClick={() =>
                                setParams({
                                  extensions: p.extensions.filter((_, j) => j !== i),
                                })
                              }
                              className="font-semibold hover:text-red-300"
                              title="Remove this extension zone"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {p.skips.map((z, i) => (
                          <span key={`s${i}`} className={chipClass}>
                            Skip {i + 1}:{" "}
                            {Math.round(sweepDegrees(z.startBearingDeg, z.endBearingDeg))}°
                            <button
                              onClick={() =>
                                setParams({ skips: p.skips.filter((_, j) => j !== i) })
                              }
                              className="font-semibold hover:text-red-300"
                              title="Remove this skip wedge"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {p.cutouts.map((_, i) => (
                          <span key={`c${i}`} className={chipClass}>
                            Cutout {i + 1}
                            <button
                              onClick={() =>
                                setParams({ cutouts: p.cutouts.filter((_, j) => j !== i) })
                              }
                              className="font-semibold hover:text-red-300"
                              title="Remove this cutout"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {p.positions.map((_, i) => (
                          <span key={`p${i}`} className={chipClass}>
                            Position {i + 2}
                            <button
                              onClick={() =>
                                setParams({
                                  positions: p.positions.filter((_, j) => j !== i),
                                })
                              }
                              className="font-semibold hover:text-red-300"
                              title="Remove this towable position"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-1.5 flex justify-center gap-2">
                      <button
                        onClick={savePivot}
                        disabled={saving}
                        className="rounded bg-kelly-500 px-3 py-1 text-xs font-semibold hover:bg-kelly-600 disabled:opacity-60"
                      >
                        {saving ? "Saving..." : "Save coverage"}
                      </button>
                      <button
                        onClick={cancelPivotEditor}
                        className="rounded bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
                {saveError ? <p className="mt-1 text-xs text-red-300">{saveError}</p> : null}
              </div>
            );
          })()
        : null}

      {/* Draw/edit/place toolbar */}
      {mode !== "view" && mode !== "pivot" ? (
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
            {mode === "edit" && editTargetType && POLYGON_TYPES.includes(editTargetType) ? (
              <>
                <button
                  onClick={() => startBoundaryOp("add")}
                  className="rounded bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
                >
                  Add area
                </button>
                <button
                  onClick={() => startBoundaryOp("subtract")}
                  className="rounded bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
                >
                  Cut area
                </button>
              </>
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
            {drawingShape ? (
              <button
                onClick={() => discardShapeRef.current()}
                title="Removes only the shape being drawn (Escape does the same); completed areas stay"
                className="rounded bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
              >
                Discard shape
              </button>
            ) : null}
            <button
              onClick={handleToolbarCancel}
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
          suggestedPropertyId={suggestedForPoly}
          saving={saving}
          error={saveError}
          onSave={saveNewBoundary}
          onCancel={cancelBoundarySession}
          onAddArea={() => startBoundaryOp("add")}
          onCutArea={() => startBoundaryOp("subtract")}
          hidden={pendingExtraDraw}
        />
      ) : null}
      {pendingLine && mode === "draw" ? (
        <NewLineDialog
          properties={properties}
          suggestedPropertyId={suggestedForLine}
          saving={saving}
          error={saveError}
          onSave={saveNewLine}
          onCancel={resetDrawState}
        />
      ) : null}
      {pendingPoint && mode === "place" ? (
        <NewAssetDialog
          properties={properties}
          suggestedPropertyId={suggestedForPoint}
          saving={saving}
          error={saveError}
          onSave={saveNewAsset}
          onCancel={resetDrawState}
        />
      ) : null}
      {pendingPivotSave && mode === "pivot" && pivotEdit ? (
        <NewAssetDialog
          properties={properties}
          suggestedPropertyId={suggestPropertyId(
            { type: "Point", coordinates: pivotEdit.params.center },
            matchableProperties
          )}
          fixedType="irrigation_pivot"
          saving={saving}
          error={saveError}
          onSave={saveNewPivot}
          onCancel={() => setPendingPivotSave(false)}
        />
      ) : null}

      {selected && selectedRow && mode === "view" ? (
        <FeaturePanel
          entityType={selected.entityType}
          row={selectedRow}
          propertyName={selectedPropertyName}
          entityName={selectedEntityName}
          farmActivity={
            selected.entityType === "field"
              ? (farmActivity.byField[selected.id] ?? null)
              : selected.entityType === "property"
                ? (farmActivity.byProperty[selected.id] ?? null)
                : null
          }
          onClose={() => setSelected(null)}
          onEditGeometry={startEditGeometry}
          onSplit={startSplitStand}
          onPivotCircle={startPivotEditor}
          onChanged={loadData}
        />
      ) : null}
    </div>
  );
}
