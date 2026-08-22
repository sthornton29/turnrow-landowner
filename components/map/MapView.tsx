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
import { drawAreaReadout, type DrawAreaReadout } from "@/lib/geo/drawArea";
import { LAND_TYPE_LABELS } from "@/lib/landLabels";
import {
  ASSET_TYPES,
  STAND_TYPE_COLORS,
  STAND_TYPE_LABELS,
} from "@/lib/assetTypes";
import {
  EASEMENT_CATEGORY_COLORS,
  EASEMENT_CATEGORY_LABELS,
  EASEMENT_STYLES,
  categoriesPresent,
  easementCategory,
} from "@/lib/easements";
import {
  DEFAULT_CIRCLE_DIAMETER_FT,
  MIN_CIRCLE_DIAMETER_FT,
  circleAcres,
  circleAreaSqFt,
  circleFromDetails,
  circlePolygon,
  detailsFromCircle,
  diameterFromRimPoint,
  formatFootprint,
  rimPoint,
  type CircleParams,
} from "@/lib/geo/circle";
import { formatNumber } from "@/lib/format";
import { addEasementLayers } from "./easementLayers";
import {
  ASSET_LIGHT_BLUE,
  CEMETERY_VIOLET,
  CEMETERY_VIOLET_DARK,
  KELLY,
  MINT,
  PASTURE_TAN,
  PINE,
  WETLAND_BLUE,
  applyDraftColor,
  draftColorFor,
} from "./drawColors";
import { ISSUE_COLORS, issueColor, issueTitle } from "@/lib/maintenance";
import NewIssueDialog, { type NewIssuePayload } from "./NewIssueDialog";
import DrawTypePicker, { type DrawType } from "./DrawTypePicker";
import AssetPlacePicker, { type AssetPlacement } from "./AssetPlacePicker";
export { KELLY, PASTURE_TAN, PINE, WETLAND_BLUE } from "./drawColors";
import { entityColor } from "@/lib/entities";
import { suggestPropertyId } from "@/lib/geo/propertyMatch";
import {
  bearingTo,
  compositeFromDetails,
  compositePivotGeometry,
  destination as pivotDestination,
  detailsFromComposite,
  distanceFt,
  snapEndBearing,
  sweepDegrees,
  type CompositePivotParams,
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
  CemeteryGeo,
  MaintenanceIssueGeo,
  EntityType,
  FieldGeo,
  ParcelGeo,
  PastureGeo,
  PropertyGeo,
  RoadGeo,
  AssetType,
  TimberStandGeo,
  EasementGeo,
  WetlandGeo,
} from "@/types/db";
import LayerToggle from "./LayerToggle";
import {
  generateMapPdf,
  mapAspect,
  type LegendEntry,
  type PrintLabelFlags,
  type PrintLayerFlags,
} from "./printPdf";
import FeaturePanel, { ENTITY_TABLE } from "./FeaturePanel";
import NewBoundaryDialog, { type BoundaryType, type NewBoundaryPayload } from "./NewBoundaryDialog";
import NewLineDialog, { type NewLinePayload } from "./NewLineDialog";
import NewAssetDialog, { type NewAssetPayload } from "./NewAssetDialog";
import type { AnyGeoRow, LayerVisibility, MapMode, SelectedFeature } from "./types";

// Pastures: warm tan, distinct from kelly (ag fields), canola light
// green, wheat amber, the timber palette, and pivot blue.
// Wetlands (OPEN wetlands: marsh, sloughs, duck holes; forested
// bottomland stays a timber stand): muted steel blue, checked distinct
// from kelly, every crop color, the timber palette including planted
// pine's deep teal #0f766e and the "other" gray #6b7280, pivot light
// blue #7dd3fc/#38bdf8, pasture tan, and entity outlines.

const POLYGON_TYPES: EntityType[] = [
  "property", "parcel", "field", "pasture", "wetland", "timber_stand",
  "easement", "cemetery", "maintenance_issue",
];

// A pick-first draw session: what the Add menu chose before the first
// point went down. Asset outlines join the same machinery.
type DrawSession = DrawType | { kind: "asset_outline"; assetType: AssetType };

function sessionColorKey(t: DrawSession): string {
  return t.kind === "asset_outline" ? "asset" : t.entityType;
}

// Straight-line length of a drawn line in feet (preview only; the
// server computes the real geodesic length on save).
function approxLengthFt(ml: MultiLineString): number {
  let total = 0;
  for (const line of ml.coordinates) {
    for (let i = 1; i < line.length; i++) {
      total += distanceFt(
        line[i - 1] as [number, number],
        line[i] as [number, number]
      );
    }
  }
  return total;
}

// An in-frame item in the print setup's property chips / item drawer.
interface PrintItemInfo {
  key: string; // "entityType:id"
  entityType: EntityType;
  id: string;
  name: string;
  propertyId: string | null;
}

const PRINT_TYPE_LABELS: Record<EntityType, string> = {
  property: "Property boundary",
  parcel: LAND_TYPE_LABELS.parcel.plural,
  field: LAND_TYPE_LABELS.field.plural,
  pasture: LAND_TYPE_LABELS.pasture.plural,
  wetland: LAND_TYPE_LABELS.wetland.plural,
  timber_stand: LAND_TYPE_LABELS.timber_stand.plural,
  road: LAND_TYPE_LABELS.road.plural,
  easement: LAND_TYPE_LABELS.easement.plural,
  asset: LAND_TYPE_LABELS.asset.plural,
  cemetery: LAND_TYPE_LABELS.cemetery.plural,
  maintenance_issue: LAND_TYPE_LABELS.maintenance_issue.plural,
};

// Tri-state checkbox for the Choose items drawer: checked = fully
// included in the print, indeterminate = partly excluded.
function TriCheckbox({
  state,
  onToggle,
}: {
  state: "all" | "some" | "none";
  onToggle: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={state === "all"}
      ref={(el) => {
        if (el) el.indeterminate = state === "some";
      }}
      onChange={onToggle}
      className="h-3.5 w-3.5 shrink-0 accent-kelly-500"
    />
  );
}

// Layer toggle defaults: parcels start OFF (they clutter the default
// view); the user's choices persist per browser and win over defaults.
const LAYER_DEFAULTS: LayerVisibility = {
  property: true,
  parcel: false,
  field: true,
  pasture: true,
  wetland: true,
  timber_stand: true,
  road: true,
  easement: true,
  asset: true,
  cemetery: true,
  maintenance_issue: true,
};
const LAYER_STORAGE_KEY = "turnrow.map.layers.v1";

function loadLayerVisibility(): LayerVisibility {
  if (typeof window === "undefined") return LAYER_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(LAYER_STORAGE_KEY);
    if (!raw) return LAYER_DEFAULTS;
    return { ...LAYER_DEFAULTS, ...(JSON.parse(raw) as Partial<LayerVisibility>) };
  } catch {
    return LAYER_DEFAULTS;
  }
}

function geomOf(row: AnyGeoRow): Geometry | null {
  if ("boundary_geojson" in row) return row.boundary_geojson;
  if ("geom_geojson" in row) return row.geom_geojson;
  return null;
}

function nameOf(row: AnyGeoRow, entityType: EntityType): string {
  if (entityType === "maintenance_issue") return issueTitle(row as MaintenanceIssueGeo);
  return entityType === "parcel"
    ? (row as ParcelGeo).parcel_number
    : ((row as { name?: string }).name ?? "");
}

// A marker point at the center of a polygon (cemetery plots and issue
// areas keep their letter marker at low zoom, like shaped assets).
function centerMarker(g: Geometry, props: Record<string, unknown>): Feature | null {
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
  const mp = toMultiPolygon(g);
  const center = mp ? labelPointOf(mp) : null;
  return center
    ? { type: "Feature", geometry: { type: "Point", coordinates: center }, properties: { ...props, marker: true } }
    : null;
}

export function rowsToFC(rows: AnyGeoRow[], entityType: EntityType): FeatureCollection {
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
    if (entityType === "easement") {
      props.easementType = (row as EasementGeo).easement_type ?? "other";
      props.easementCategory = easementCategory((row as EasementGeo).easement_type);
    }
    if (entityType === "cemetery") props.letter = "C";
    if (entityType === "maintenance_issue") {
      const i = row as MaintenanceIssueGeo;
      const c = issueColor(i);
      props.letter = "!";
      props.status = i.status;
      props.severity = i.severity ?? "";
      props.issueType = i.issue_type;
      props.issueFill = c.fill;
      props.issueLine = c.line;
    }
    features.push({ type: "Feature", geometry: g, properties: props });
    if (entityType === "cemetery" || entityType === "maintenance_issue") {
      const m = centerMarker(g, props);
      if (m) features.push(m);
    }
    // Shaped assets (pivot coverage, outline footprints, circles) keep
    // their letter marker at the center for low-zoom recognition
    // (clickable like the polygon).
    if (entityType === "asset") {
      const a = row as AssetGeo;
      if (g.type === "Polygon" || g.type === "MultiPolygon") {
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

// Properties carry their entity's color for the color-by-entity mode.
function propertiesFCWithEntity(
  properties: PropertyGeo[],
  entities: Array<{ id: string; name: string }>
): FeatureCollection {
  const entityIndex = new Map(entities.map((e, i) => [e.id, i]));
  const fc = rowsToFC(properties, "property");
  for (const feature of fc.features) {
    const row = properties.find((p) => p.id === feature.properties?.id);
    if (row?.entity_id !== null && row?.entity_id !== undefined) {
      const idx = entityIndex.get(row.entity_id);
      if (idx !== undefined) {
        feature.properties = { ...feature.properties, entityColor: entityColor(idx) };
      }
    }
  }
  return fc;
}

// Ag fields carry their current-year crop color for the Crops toggle.
function fieldsFCWithCrops(
  fields: FieldGeo[],
  byField: Record<string, FarmActivityInfo[]>
): FeatureCollection {
  const fc = rowsToFC(fields, "field");
  for (const feature of fc.features) {
    const activity = byField[String(feature.properties?.id)];
    if (activity?.length) {
      feature.properties = { ...feature.properties, cropColor: activity[0].color };
    }
  }
  return fc;
}

export function rowsToLabelFC(rows: AnyGeoRow[], entityType: EntityType): FeatureCollection {
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
  orgName,
  focus,
}: {
  orgId: string;
  orgName?: string | null;
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
  const [wetlands, setWetlands] = useState<WetlandGeo[]>([]);
  const [timber, setTimber] = useState<TimberStandGeo[]>([]);
  const [roads, setRoads] = useState<RoadGeo[]>([]);
  const [easements, setEasements] = useState<EasementGeo[]>([]);
  const [assets, setAssets] = useState<AssetGeo[]>([]);
  const [cemeteries, setCemeteries] = useState<CemeteryGeo[]>([]);
  const [issues, setIssues] = useState<MaintenanceIssueGeo[]>([]);
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
  const [visibility, setVisibility] = useState<LayerVisibility>(loadLayerVisibility);
  useEffect(() => {
    try {
      window.localStorage.setItem(LAYER_STORAGE_KEY, JSON.stringify(visibility));
    } catch {
      // Private browsing without storage: toggles just do not persist.
    }
  }, [visibility]);
  const [fullscreen, setFullscreen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Draw/save state. drawKind is the tool (polygon or line); the
  // session says what it becomes (fixed before drawing).
  const drawKindRef = useRef<"boundary" | "line" | null>(null);
  const [drawSession, setDrawSession] = useState<DrawSession | null>(null);
  const drawSessionRef = useRef<DrawSession | null>(null);
  drawSessionRef.current = drawSession;
  const [pickerOpen, setPickerOpen] = useState<"draw" | "asset" | null>(null);
  // Pin placement for a type chosen up front (null = legacy any-type).
  const [placeAssetType, setPlaceAssetType] = useState<AssetType | null>(null);
  // Crosshair is placing a NEW circle footprint's center for this type.
  const placeForCircleRef = useRef<AssetType | null>(null);
  // Editing a saved line (road, line easement, pipe/fence): no boolean
  // area tools in the toolbar.
  const [editIsLine, setEditIsLine] = useState(false);
  // Ids of the shared easement layers (visibility toggles).
  const easementLayerIdsRef = useRef<string[]>([]);
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
  // Per-shape acreage while drawing a boundary: the shape in progress,
  // each completed area, and the total (lib/geo/drawArea.ts). Refreshed
  // on every draw render; completed areas also get an on-map label.
  const [areaReadout, setAreaReadout] = useState<DrawAreaReadout | null>(null);
  const refreshAreaReadoutRef = useRef<() => void>(() => {});
  refreshAreaReadoutRef.current = () => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;
    if (drawKindRef.current !== "boundary" || editTargetRef.current || boundaryOpRef.current) {
      setAreaReadout(null);
      (map.getSource("draw-area-labels") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const features = draw.getAll().features.map((f) => ({ id: f.id, geometry: f.geometry }));
    const readout = drawAreaReadout(features, completedDrawIdsRef.current);
    setAreaReadout(readout);
    const labels: Feature[] = [];
    readout.completed.forEach((s, i) => {
      const f = draw.get(s.id);
      const mp = f ? toMultiPolygon(f.geometry) : null;
      const pt = mp ? labelPointOf(mp) : null;
      if (!pt) return;
      labels.push({
        type: "Feature",
        properties: { label: `Area ${i + 1} · ${formatAcres(s.acres)} ac` },
        geometry: { type: "Point", coordinates: pt },
      });
    });
    (map.getSource("draw-area-labels") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: labels });
  };

  // Parametric pivot coverage editor: the geometry is always derived
  // from the params (base circle/arc + manually drawn add/cut
  // polygons); never vertex-edited.
  // assetId null = a NEW pivot from the Add menu (crosshair placed the
  // center); Save then asks for name/property before inserting.
  const [pivotEdit, setPivotEdit] = useState<{
    assetId: string | null;
    params: CompositePivotParams;
  } | null>(null);
  const pivotEditRef = useRef(pivotEdit);
  pivotEditRef.current = pivotEdit;
  // Drawing an add (irrigated lobe) or cut (pond, obstacle) polygon
  // inside the pivot editor.
  const pivotShapeKindRef = useRef<"add" | "cut" | null>(null);
  const [pivotDrawKind, setPivotDrawKind] = useState<"add" | "cut" | null>(null);
  // Crosshair placement is for a new pivot's center (Add menu), not an
  // asset pin.
  const placeForPivotRef = useRef(false);
  const [pendingPivotSave, setPendingPivotSave] = useState(false);

  // Parametric circle footprint editor (grain bins and any round
  // structure): center + diameter, polygon derived, never vertex-edited.
  // assetId null = a NEW asset from the Add menu; Save asks for name and
  // property. For grain bins diameterFt IS details.diameter_ft.
  const [circleEdit, setCircleEdit] = useState<{
    assetId: string | null;
    assetType: AssetType;
    params: CircleParams;
    existingDetails: Record<string, unknown>;
  } | null>(null);
  const circleEditRef = useRef(circleEdit);
  circleEditRef.current = circleEdit;
  const [pendingCircleSave, setPendingCircleSave] = useState(false);

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

  // ------------------------------------------------------------ print setup
  // A page-aspect frame overlays the map; the user pans/zooms freely
  // underneath to set the exact printed extent (WYSIWYG). Generation
  // renders that extent at print resolution and downloads a PDF.
  const [printOpen, setPrintOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printOrientation, setPrintOrientation] =
    useState<"landscape" | "portrait">("landscape");
  const [printLayers, setPrintLayers] = useState<PrintLayerFlags>({
    property: true, parcel: false, field: true, pasture: true, wetland: true,
    timber_stand: true, road: true, easement: true, asset: true,
    cemetery: true, maintenance: true,
    crops: false, entity: false,
  });
  const [printLabels, setPrintLabels] = useState<PrintLabelFlags>({
    property: true, parcel: false, field: true, pasture: true, wetland: true,
    timber_stand: true, road: true, easement: true, asset: true, cemetery: true,
  });
  const [printTitle, setPrintTitle] = useState("");
  const [printSubtitle, setPrintSubtitle] = useState("");
  // Per-print-session item exclusions (never persisted): keys are
  // "entityType:id". Tap an item on the preview to toggle it out
  // (ghosted); the property chips and the Choose items drawer write
  // into this same set, so every control stays in sync. Excluding a
  // whole property expands to its boundary plus everything on it.
  const [printExcluded, setPrintExcluded] = useState<Set<string>>(new Set());
  const [printDrawerOpen, setPrintDrawerOpen] = useState(false);
  const [printItemFilter, setPrintItemFilter] = useState("");
  // Bumped on map move while the print frame is up so the in-frame
  // item list tracks the framed extent.
  const [printViewVersion, setPrintViewVersion] = useState(0);
  const printOpenRef = useRef(printOpen);
  printOpenRef.current = printOpen;

  // ---------------------------------------------------------------- data

  const loadData = useCallback(async () => {
    const currentYear = new Date().getFullYear();
    const [p, pa, f, pas, w, t, r, ue, a, mappings, farmData, connections, ents, cem, iss] = await Promise.all([
      supabase.from("properties_geo").select("*").order("name"),
      supabase.from("parcels_geo").select("*").order("parcel_number"),
      supabase.from("fields_geo").select("*").order("name"),
      supabase.from("pastures_geo").select("*").order("name"),
      supabase.from("wetlands_geo").select("*").order("name"),
      supabase.from("timber_stands_geo").select("*").order("name"),
      supabase.from("roads_geo").select("*").order("name"),
      supabase.from("easements_geo").select("*").order("name"),
      supabase.from("assets_geo").select("*").eq("is_active", true).order("name"),
      supabase.from("field_mappings").select("*").eq("status", "confirmed"),
      supabase.from("farm_field_data").select("*").eq("crop_year", currentYear),
      supabase.from("farm_connections").select("id, label"),
      supabase.from("entities").select("id, name").order("name"),
      supabase.from("cemeteries_geo").select("*").order("name"),
      supabase.from("maintenance_issues_geo").select("*").order("created_at", { ascending: false }),
    ]);
    setEntities((ents.data as Array<{ id: string; name: string }>) ?? []);
    setCemeteries((cem.data as CemeteryGeo[]) ?? []);
    setIssues((iss.data as MaintenanceIssueGeo[]) ?? []);
    setProperties((p.data as PropertyGeo[]) ?? []);
    setParcels((pa.data as ParcelGeo[]) ?? []);
    setFields((f.data as FieldGeo[]) ?? []);
    setPastures((pas.data as PastureGeo[]) ?? []);
    setWetlands((w.data as WetlandGeo[]) ?? []);
    setTimber((t.data as TimberStandGeo[]) ?? []);
    setRoads((r.data as RoadGeo[]) ?? []);
    setEasements((ue.data as EasementGeo[]) ?? []);
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
        entity: row.remote_entity_name ?? null,
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
      wetland: wetlands,
      timber_stand: timber,
      road: roads,
      easement: easements,
      asset: assets,
      cemetery: cemeteries,
      maintenance_issue: issues,
    }),
    [properties, parcels, fields, pastures, wetlands, timber, roads, easements, assets, cemeteries, issues]
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
      ["maintenance-circle", "maintenance-line", "maintenance-fill"],
      ["assets-circle", "assets-line", "assets-fill", "pivot-circles-fill"],
      ["cemeteries-circle"],
      ["roads-hit"],
      ["easements-hit", "easements-fill", "easements-hatch-base"],
      ["fields-fill"],
      ["pastures-fill"],
      ["cemeteries-fill"],
      ["wetlands-fill"],
      ["timber-fill"],
      ["parcels-fill"],
      ["properties-fill"],
    ];
    if (printOpen) {
      // Print setup: tapping any rendered item toggles it out of the
      // print (ghosted); tapping a ghosted item restores it.
      const ghostLayers = [
        "print-ghost-circle", "print-ghost-line", "print-ghost-fill",
      ].filter((l) => map.getLayer(l));
      if (ghostLayers.length > 0) {
        const ghostHits = map.queryRenderedFeatures(e.point, { layers: ghostLayers });
        if (ghostHits.length > 0) {
          const props = ghostHits[0].properties as { id: string; entityType: EntityType };
          setPrintExcluded((prev) => {
            const next = new Set(prev);
            next.delete(`${props.entityType}:${props.id}`);
            return next;
          });
          return;
        }
      }
      for (const group of groups) {
        const layers = group.filter((l) => map.getLayer(l));
        if (layers.length === 0) continue;
        const hits = map.queryRenderedFeatures(e.point, { layers });
        if (hits.length > 0) {
          const props = hits[0].properties as { id: string; entityType: EntityType };
          setPrintExcluded((prev) => {
            const next = new Set(prev);
            next.add(`${props.entityType}:${props.id}`);
            return next;
          });
          return;
        }
      }
      return;
    }
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
        "properties", "parcels", "fields", "pastures", "wetlands", "timber",
        "roads", "easements", "assets", "cemeteries", "maintenance",
        "property-labels", "parcel-labels", "field-labels", "pasture-labels",
        "wetland-labels", "timber-labels", "easement-labels", "cemetery-labels",
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

      // Wetlands: muted steel blue (open wetlands only)
      map.addLayer({ id: "wetlands-fill", type: "fill", source: "wetlands",
        paint: { "fill-color": WETLAND_BLUE, "fill-opacity": 0.3 } });
      map.addLayer({ id: "wetlands-line", type: "line", source: "wetlands",
        paint: { "line-color": WETLAND_BLUE, "line-width": 2 } });

      // Cemeteries: muted violet plot (the "C" marker sits on top, below)
      map.addLayer({ id: "cemeteries-fill", type: "fill", source: "cemeteries",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": CEMETERY_VIOLET, "fill-opacity": 0.35 } });
      map.addLayer({ id: "cemeteries-line", type: "line", source: "cemeteries",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": CEMETERY_VIOLET_DARK, "line-width": 2 } });

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

      // Easements: category-styled fills/outlines (conservation hatch,
      // railroad ties, line easements on the same layers); shared with
      // the print renderer in ./easementLayers.ts.
      easementLayerIdsRef.current = addEasementLayers(map, "easements").ids;

      // Asset lines (pipe, fence): dashed light blue, distinct from roads.
      // Asset polygons (footprints, pond surface): faint white. Pivot
      // coverage circles get their own light blue look below.
      const isIrrigation: mapboxgl.Expression = [
        "==", ["get", "assetType"], "irrigation_pivot",
      ];
      const notPivot: mapboxgl.Expression = ["!", isIrrigation];
      // Footprints (outline-drawn or circle): light fill + light blue
      // outline, the letter marker sits at the centroid (rowsToFC).
      map.addLayer({ id: "assets-fill", type: "fill", source: "assets",
        filter: ["all", ["==", ["geometry-type"], "Polygon"], notPivot],
        paint: { "fill-color": ASSET_LIGHT_BLUE, "fill-opacity": 0.14 } });
      map.addLayer({ id: "assets-outline", type: "line", source: "assets",
        filter: ["all", ["==", ["geometry-type"], "Polygon"], notPivot],
        paint: { "line-color": ASSET_LIGHT_BLUE, "line-width": 2 } });
      map.addLayer({ id: "pivot-circles-fill", type: "fill", source: "assets",
        filter: ["all", ["==", ["geometry-type"], "Polygon"], isIrrigation],
        paint: { "fill-color": "#7dd3fc", "fill-opacity": 0.18 } });
      map.addLayer({ id: "pivot-circles-line", type: "line", source: "assets",
        filter: ["all", ["==", ["geometry-type"], "Polygon"], isIrrigation],
        paint: { "line-color": "#38bdf8", "line-width": 2 } });
      map.addLayer({ id: "assets-line", type: "line", source: "assets",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": ASSET_LIGHT_BLUE, "line-width": 2, "line-dasharray": [2, 2] } });

      // Selection highlights
      for (const src of ["properties", "parcels", "fields", "pastures", "wetlands", "timber", "cemeteries"]) {
        map.addLayer({ id: `${src}-selected`, type: "line", source: src,
          paint: { "line-color": "#ffffff", "line-width": 4.5 },
          filter: ["==", ["get", "id"], ""] });
      }
      map.addLayer({ id: "roads-selected", type: "line", source: "roads",
        paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.9 },
        filter: ["==", ["get", "id"], ""] });
      map.addLayer({ id: "easements-selected", type: "line", source: "easements",
        paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.9 },
        filter: ["==", ["get", "id"], ""] });
      map.addLayer({ id: "assets-selected-line", type: "line", source: "assets",
        paint: { "line-color": "#ffffff", "line-width": 4.5 },
        filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "id"], ""]] });
      map.addLayer({ id: "maintenance-selected", type: "line", source: "maintenance",
        paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.9 },
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
      map.addLayer({ id: "wetland-labels", type: "symbol", source: "wetland-labels",
        layout: { "text-field": ["get", "name"], "text-size": 11.5,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#e2ecf5", "text-halo-color": "#2c3f52", "text-halo-width": 1.2 } });
      map.addLayer({ id: "timber-labels", type: "symbol", source: "timber-labels",
        layout: { "text-field": ["get", "name"], "text-size": 11.5,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#ffffff", "text-halo-color": PINE, "text-halo-width": 1.3 } });
      map.addLayer({ id: "cemetery-labels", type: "symbol", source: "cemetery-labels",
        layout: { "text-field": ["get", "name"], "text-size": 10.5,
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#f3e8ff", "text-halo-color": "#4c1d95", "text-halo-width": 1.2 } });
      map.addLayer({ id: "parcel-labels", type: "symbol", source: "parcel-labels",
        layout: { "text-field": ["get", "name"], "text-size": 10,
          "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#e5e7eb", "text-halo-color": "#374151", "text-halo-width": 1 } });
      map.addLayer({ id: "road-labels", type: "symbol", source: "roads",
        layout: { "symbol-placement": "line", "text-field": ["get", "name"],
          "text-size": 10, "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#ffffff", "text-halo-color": PINE, "text-halo-width": 1.2 } });
      map.addLayer({ id: "easement-labels", type: "symbol", source: "easement-labels",
        layout: { "text-field": ["get", "name"], "text-size": 10,
          "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#ffffff", "text-halo-color": "#7f1d1d", "text-halo-width": 1.1 } });

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

      // Cemetery markers: violet circle + "C" (pins, and the center of plots)
      map.addLayer({ id: "cemeteries-circle", type: "circle", source: "cemeteries",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 10, "circle-color": CEMETERY_VIOLET_DARK,
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "cemeteries-letter", type: "symbol", source: "cemeteries",
        filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": "C", "text-size": 9,
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" } });
      map.addLayer({ id: "cemeteries-name", type: "symbol", source: "cemeteries",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "marker"]]], minzoom: 12,
        layout: { "text-field": ["get", "name"], "text-size": 10,
          "text-offset": [0, 1.6],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#f3e8ff", "text-halo-color": "#4c1d95", "text-halo-width": 1.2 } });

      // Maintenance issues on top of everything: warning colors from
      // each feature (amber open, red high, gray resolved), dashed
      // lines, "!" markers for pins and at the center of areas.
      const issueFill: mapboxgl.Expression = ["coalesce", ["get", "issueFill"], ISSUE_COLORS.open.fill];
      const issueLine: mapboxgl.Expression = ["coalesce", ["get", "issueLine"], ISSUE_COLORS.open.line];
      map.addLayer({ id: "maintenance-fill", type: "fill", source: "maintenance",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": issueFill,
          "fill-opacity": ["case", ["==", ["get", "status"], "resolved"], 0.15, 0.35] } });
      map.addLayer({ id: "maintenance-outline", type: "line", source: "maintenance",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": issueLine, "line-width": 2 } });
      map.addLayer({ id: "maintenance-line", type: "line", source: "maintenance",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round" },
        paint: { "line-color": issueLine, "line-width": 3.5, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "maintenance-circle", type: "circle", source: "maintenance",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 10, "circle-color": issueFill,
          "circle-opacity": ["case", ["==", ["get", "status"], "resolved"], 0.6, 1],
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      map.addLayer({ id: "maintenance-letter", type: "symbol", source: "maintenance",
        filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": "!", "text-size": 11,
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true },
        paint: { "text-color": "#ffffff" } });
      map.addLayer({ id: "maintenance-name", type: "symbol", source: "maintenance",
        filter: ["==", ["geometry-type"], "Point"], minzoom: 13,
        layout: { "text-field": ["get", "name"], "text-size": 10,
          "text-offset": [0, 1.6],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#fffbeb", "text-halo-color": "#78350f", "text-halo-width": 1.2 } });

      // Print-mode ghosts: items excluded from the print render here
      // (heavy transparency + slash pattern) instead of their normal
      // layers, and tapping a ghost restores the item.
      {
        const size = 12;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-3, size + 3);
          ctx.lineTo(size + 3, -3);
          ctx.stroke();
          map.addImage("print-slash", ctx.getImageData(0, 0, size, size), {
            pixelRatio: 1,
          });
        }
      }
      map.addSource("print-ghost", { type: "geojson", data: empty });
      map.addLayer({ id: "print-ghost-fill", type: "fill", source: "print-ghost",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-pattern": "print-slash", "fill-opacity": 0.45 } });
      map.addLayer({ id: "print-ghost-outline", type: "line", source: "print-ghost",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": "#9ca3af", "line-width": 1.5,
          "line-dasharray": [2, 2], "line-opacity": 0.7 } });
      map.addLayer({ id: "print-ghost-line", type: "line", source: "print-ghost",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#9ca3af", "line-width": 2.5,
          "line-dasharray": [1.5, 2], "line-opacity": 0.55 } });
      map.addLayer({ id: "print-ghost-circle", type: "circle", source: "print-ghost",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 9, "circle-color": "#9ca3af",
          "circle-opacity": 0.35, "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.5 } });

      // Acre labels on completed areas of the boundary being drawn.
      map.addSource("draw-area-labels", { type: "geojson", data: empty });
      map.addLayer({
        id: "draw-area-labels",
        type: "symbol",
        source: "draw-area-labels",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#14532d", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
      });
      for (const ev of ["draw.render", "draw.update", "draw.selectionchange", "draw.delete"]) {
        map.on(ev, () => refreshAreaReadoutRef.current());
      }

      map.on("move", () => {
        if (printOpenRef.current) setPrintViewVersion((v) => v + 1);
      });

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
        if (!pivotEditRef.current && !circleEditRef.current) return;
        e.preventDefault();
        beginPivotDrag(String(e.features?.[0]?.properties?.role ?? ""));
      });
      map.on("touchstart", "pivot-handles", (e) => {
        if (!pivotEditRef.current && !circleEditRef.current) return;
        e.preventDefault();
        beginPivotDrag(String(e.features?.[0]?.properties?.role ?? ""));
      });

      setMapLoaded(true);
    });

    map.on("click", (e) => clickRef.current(e));
    for (const layer of [
      "properties-fill", "parcels-fill", "fields-fill", "pastures-fill",
      "wetlands-fill", "timber-fill", "roads-hit", "easements-fill",
      "easements-hatch-base", "easements-hit",
      "assets-circle", "assets-line", "assets-fill",
      "cemeteries-fill", "cemeteries-circle",
      "maintenance-fill", "maintenance-line", "maintenance-circle",
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
      if (pivotShapeKindRef.current && geometry.type === "Polygon") {
        // Add/cut polygon drawn inside the pivot editor.
        addPivotShapeRef.current(geometry);
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

    // Print-mode item exclusions: excluded items leave their normal
    // layers (and labels) and render in the ghost source instead.
    const excluded = printOpen ? printExcluded : new Set<string>();
    const inc = <T extends AnyGeoRow>(rows: T[], type: EntityType): T[] =>
      excluded.size === 0
        ? rows
        : rows.filter((r) => !excluded.has(`${type}:${r.id}`));

    setData("properties", propertiesFCWithEntity(inc(properties, "property") as PropertyGeo[], entities));
    setData("parcels", rowsToFC(inc(parcels, "parcel"), "parcel"));
    setData("fields", fieldsFCWithCrops(inc(fields, "field") as FieldGeo[], farmActivity.byField));
    setData("pastures", rowsToFC(inc(pastures, "pasture"), "pasture"));
    setData("wetlands", rowsToFC(inc(wetlands, "wetland"), "wetland"));
    setData("timber", rowsToFC(inc(timber, "timber_stand"), "timber_stand"));
    setData("roads", rowsToFC(inc(roads, "road"), "road"));
    setData("easements", rowsToFC(inc(easements, "easement"), "easement"));
    setData("assets", rowsToFC(inc(assets, "asset"), "asset"));
    setData("cemeteries", rowsToFC(inc(cemeteries, "cemetery"), "cemetery"));
    setData("maintenance", rowsToFC(inc(issues, "maintenance_issue"), "maintenance_issue"));
    setData("cemetery-labels", rowsToLabelFC(inc(cemeteries, "cemetery"), "cemetery"));
    setData("property-labels", rowsToLabelFC(inc(properties, "property"), "property"));
    setData("parcel-labels", rowsToLabelFC(inc(parcels, "parcel"), "parcel"));
    setData("field-labels", rowsToLabelFC(inc(fields, "field"), "field"));
    setData("pasture-labels", rowsToLabelFC(inc(pastures, "pasture"), "pasture"));
    setData("wetland-labels", rowsToLabelFC(inc(wetlands, "wetland"), "wetland"));
    setData("timber-labels", rowsToLabelFC(inc(timber, "timber_stand"), "timber_stand"));
    setData("easement-labels", rowsToLabelFC(inc(easements, "easement"), "easement"));

    const ghostFeatures: Feature[] = [];
    if (printOpen && excluded.size > 0) {
      for (const [type, rows] of Object.entries(rowLists) as Array<
        [EntityType, AnyGeoRow[]]
      >) {
        if (!visibility[type]) continue;
        for (const row of rows) {
          if (!excluded.has(`${type}:${row.id}`)) continue;
          const g = geomOf(row);
          if (!g) continue;
          ghostFeatures.push({
            type: "Feature",
            geometry: g,
            properties: { id: row.id, entityType: type },
          });
        }
      }
    }
    setData("print-ghost", { type: "FeatureCollection", features: ghostFeatures });

    if (!didFitRef.current) {
      const box = bboxOf([
        ...properties.map(geomOf), ...parcels.map(geomOf), ...fields.map(geomOf),
        ...pastures.map(geomOf), ...wetlands.map(geomOf), ...timber.map(geomOf),
        ...roads.map(geomOf), ...easements.map(geomOf), ...assets.map(geomOf),
        ...cemeteries.map(geomOf), ...issues.map(geomOf),
      ]);
      if (box) {
        map.fitBounds(box, { padding: 60, duration: 0 });
        didFitRef.current = true;
      }
    }
  }, [mapLoaded, properties, parcels, fields, pastures, wetlands, timber, roads, easements, assets, cemeteries, issues, farmActivity, entities, printOpen, printExcluded, visibility, rowLists]);

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
      ["wetland", ["wetlands-fill", "wetlands-line", "wetland-labels"]],
      ["timber_stand", ["timber-fill", "timber-line", "timber-labels"]],
      ["road", ["roads-casing", "roads-line", "roads-hit", "road-labels"]],
      ["easement", [...easementLayerIdsRef.current, "easement-labels"]],
      ["asset", ["assets-fill", "assets-outline", "assets-line", "assets-circle", "assets-letter", "assets-name", "pivot-circles-fill", "pivot-circles-line"]],
      ["cemetery", ["cemeteries-fill", "cemeteries-line", "cemeteries-circle", "cemeteries-letter", "cemeteries-name", "cemetery-labels"]],
      ["maintenance_issue", ["maintenance-fill", "maintenance-outline", "maintenance-line", "maintenance-circle", "maintenance-letter", "maintenance-name"]],
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
      properties: "", parcels: "", fields: "", pastures: "", wetlands: "",
      timber: "", roads: "", easements: "", assets: "", cemeteries: "", maintenance: "",
    };
    if (selected) {
      const srcName: Record<EntityType, string> = {
        property: "properties", parcel: "parcels", field: "fields",
        pasture: "pastures", wetland: "wetlands", timber_stand: "timber",
        road: "roads", easement: "easements", asset: "assets",
        cemetery: "cemeteries", maintenance_issue: "maintenance",
      };
      bySource[srcName[selected.entityType]] = selected.id;
    }
    if (map.getLayer("maintenance-selected")) {
      map.setFilter("maintenance-selected",
        ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "id"], bySource.maintenance]]);
    }
    for (const [layer, key] of [["maintenance-circle", "maintenance"], ["cemeteries-circle", "cemeteries"]] as const) {
      if (map.getLayer(layer)) {
        map.setPaintProperty(layer, "circle-stroke-color",
          ["case", ["==", ["get", "id"], bySource[key]], KELLY, "#ffffff"]);
        map.setPaintProperty(layer, "circle-stroke-width",
          ["case", ["==", ["get", "id"], bySource[key]], 3.5, 2]);
      }
    }
    for (const src of ["properties", "parcels", "fields", "pastures", "wetlands", "timber", "cemeteries"]) {
      if (map.getLayer(`${src}-selected`)) {
        map.setFilter(`${src}-selected`, ["==", ["get", "id"], bySource[src]]);
      }
    }
    if (map.getLayer("roads-selected")) {
      map.setFilter("roads-selected", ["==", ["get", "id"], bySource.roads]);
    }
    if (map.getLayer("easements-selected")) {
      map.setFilter("easements-selected", ["==", ["get", "id"], bySource.easements]);
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
    placeForCircleRef.current = null;
    setPlaceAssetType(null);
    setDrawSession(null);
    setEditIsLine(false);
    setAreaReadout(null);
    (mapRef.current?.getSource("draw-area-labels") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
    if (mapRef.current) applyDraftColor(mapRef.current, null);
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

  // Finish drawing an add/cut polygon: store it and return to handles.
  const addPivotShapeRef = useRef<(polygon: Polygon) => void>(() => {});
  addPivotShapeRef.current = (polygon: Polygon) => {
    const kind = pivotShapeKindRef.current;
    pivotShapeKindRef.current = null;
    setPivotDrawKind(null);
    drawRef.current?.deleteAll();
    if (!kind) return;
    setPivotEdit((edit) =>
      edit
        ? {
            ...edit,
            params:
              kind === "add"
                ? { ...edit.params, addPolygons: [...edit.params.addPolygons, polygon] }
                : { ...edit.params, cutPolygons: [...edit.params.cutPolygons, polygon] },
          }
        : edit
    );
  };

  function startPivotShape(kind: "add" | "cut") {
    const draw = drawRef.current;
    if (!draw) return;
    pivotShapeKindRef.current = kind;
    setPivotDrawKind(kind);
    draw.changeMode("draw_polygon");
  }

  const applyPivotDragRef = useRef<(role: string, lngLat: [number, number]) => void>(
    () => {}
  );
  applyPivotDragRef.current = (role, lngLat) => {
    if (circleEditRef.current) {
      setCircleEdit((edit) => {
        if (!edit) return edit;
        if (role === "center") return { ...edit, params: { ...edit.params, center: lngLat } };
        if (role === "radius") {
          return {
            ...edit,
            params: { ...edit.params, diameterFt: diameterFromRimPoint(edit.params.center, lngLat) },
          };
        }
        return edit;
      });
      return;
    }
    setPivotEdit((edit) => {
      if (!edit) return edit;
      const p = edit.params;
      if (role === "center") {
        return { ...edit, params: { ...p, center: lngLat } };
      }
      if (role === "radius") {
        return {
          ...edit,
          params: { ...p, radiusFt: Math.max(50, Math.round(distanceFt(p.center, lngLat))) },
        };
      }
      if (role === "start" && p.endBearingDeg !== null) {
        // Snap so the SWEEP lands on 90/180/270 within ~3 degrees.
        let bearing = bearingTo(p.center, lngLat);
        for (const target of [90, 180, 270]) {
          if (Math.abs(sweepDegrees(bearing, p.endBearingDeg) - target) <= 3) {
            bearing = (p.endBearingDeg - target + 360) % 360;
            break;
          }
        }
        return { ...edit, params: { ...p, startBearingDeg: Math.round(bearing * 10) / 10 } };
      }
      if (role === "end" && p.startBearingDeg !== null) {
        const bearing = snapEndBearing(p.startBearingDeg, bearingTo(p.center, lngLat));
        return { ...edit, params: { ...p, endBearingDeg: Math.round(bearing * 10) / 10 } };
      }
      return edit;
    });
  };

  // Preview + handle sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    const preview = map.getSource("pivot-preview") as GeoJSONSource | undefined;
    const handles = map.getSource("pivot-handles") as GeoJSONSource | undefined;
    if (circleEdit) {
      const c = circleEdit.params;
      preview?.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: circlePolygon(c) }],
      });
      handles?.setData({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { role: "center", kind: "center" },
            geometry: { type: "Point", coordinates: c.center } },
          { type: "Feature", properties: { role: "radius", kind: "radius" },
            geometry: { type: "Point", coordinates: rimPoint(c) } },
        ],
      });
      return;
    }
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
    const at = (
      center: [number, number],
      radiusFt: number,
      bearing: number
    ): [number, number] =>
      pivotDestination(center, radiusFt * 0.3048, bearing) as [number, number];
    const midBearing = p.fullCircle
      ? 90
      : (p.startBearingDeg! + sweepDegrees(p.startBearingDeg!, p.endBearingDeg!) / 2) % 360;
    const handleFeatures: Feature[] = [
      { type: "Feature", properties: { role: "center", kind: "center" },
        geometry: { type: "Point", coordinates: p.center } },
      { type: "Feature", properties: { role: "radius", kind: "radius" },
        geometry: { type: "Point", coordinates: at(p.center, p.radiusFt, midBearing) } },
    ];
    if (!p.fullCircle && p.startBearingDeg !== null && p.endBearingDeg !== null) {
      handleFeatures.push(
        { type: "Feature", properties: { role: "start", kind: "start" },
          geometry: { type: "Point", coordinates: at(p.center, p.radiusFt, p.startBearingDeg) } },
        { type: "Feature", properties: { role: "end", kind: "end" },
          geometry: { type: "Point", coordinates: at(p.center, p.radiusFt, p.endBearingDeg) } }
      );
    }
    handles?.setData({ type: "FeatureCollection", features: handleFeatures });
  }, [pivotEdit, circleEdit, mapLoaded]);

  // ---- Circle footprint editor (grain bins, round structures) ----

  function openCircleEditor(
    assetId: string | null,
    assetType: AssetType,
    params: CircleParams,
    existingDetails: Record<string, unknown>
  ) {
    const map = mapRef.current;
    setSelected(null);
    setSaveError(null);
    setMode("circle");
    setCircleEdit({ assetId, assetType, params, existingDetails });
    if (map) {
      const box = bboxOf([circlePolygon(params)]);
      if (box) map.fitBounds(box, { padding: 120, duration: 300, maxZoom: 19 });
    }
  }

  // From the click panel: reopen a saved circle, or start one for an
  // asset that has a pin (the pin becomes the center) or no shape.
  function startCircleEditor() {
    const map = mapRef.current;
    const row = selectedRow as AssetGeo | null;
    if (!map || !row || !selected || selected.entityType !== "asset") return;
    const details = (row.details ?? {}) as Record<string, unknown>;
    let params = circleFromDetails(details);
    if (!params) {
      const g = row.geom_geojson;
      let center: [number, number] = [map.getCenter().lng, map.getCenter().lat];
      if (g?.type === "Point") center = g.coordinates as [number, number];
      else if (g) {
        const mp = toMultiPolygon(g);
        const pt = mp ? labelPointOf(mp) : null;
        if (pt) center = pt;
      }
      const d = Number(details.diameter_ft);
      params = { center, diameterFt: d > 0 ? d : DEFAULT_CIRCLE_DIAMETER_FT };
    }
    openCircleEditor(row.id, row.asset_type, params, details);
  }

  function cancelCircleEditor() {
    setCircleEdit(null);
    setPendingCircleSave(false);
    setMode("view");
    setSaveError(null);
  }

  async function saveCircle() {
    const edit = circleEditRef.current;
    if (!edit) return;
    if (edit.assetId === null) {
      setPendingCircleSave(true);
      return;
    }
    const details = { ...edit.existingDetails, ...detailsFromCircle(edit.params) };
    setSaving(true);
    const { error: dErr } = await supabase
      .from("assets")
      .update({ details })
      .eq("id", edit.assetId);
    const gErr = dErr
      ? null
      : await applyGeometry({ entityType: "asset", id: edit.assetId }, circlePolygon(edit.params));
    setSaving(false);
    if (dErr || gErr) {
      setSaveError("Could not save the circle. " + (dErr?.message ?? gErr?.message ?? ""));
      return;
    }
    const sel: SelectedFeature = { entityType: "asset", id: edit.assetId };
    cancelCircleEditor();
    await loadData();
    setSelected(sel);
  }

  async function saveNewCircleAsset(payload: NewAssetPayload) {
    const edit = circleEditRef.current;
    if (!edit) return;
    setSaving(true);
    setSaveError(null);
    const sel = await insertAndSetGeometry(
      "assets",
      {
        organization_id: orgId,
        property_id: payload.propertyId,
        name: payload.name,
        asset_type: edit.assetType,
        details: detailsFromCircle(edit.params),
      },
      "asset",
      circlePolygon(edit.params)
    );
    setSaving(false);
    if (sel) {
      cancelCircleEditor();
      await loadData();
      setSelected(sel);
    }
  }

  function startPivotEditor() {
    const map = mapRef.current;
    const row = selectedRow as AssetGeo | null;
    if (!map || !row || !selected || selected.entityType !== "asset") return;
    const details = (row.details ?? {}) as Record<string, unknown>;
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
        addPolygons: [],
        cutPolygons: [],
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
    pivotShapeKindRef.current = null;
    setPivotDrawKind(null);
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

  // Add menu: Draw and Asset open a picker FIRST; the pivot goes
  // straight to crosshair placement (its type is implied).
  function startAdd(kind: "draw" | "asset" | "pivot") {
    setAddMenuOpen(false);
    setSelected(null);
    setSaveError(null);
    editTargetRef.current = null;
    if (kind === "draw" || kind === "asset") {
      setPickerOpen(kind);
      return;
    }
    placeForPivotRef.current = true;
    setCrosshairPos(null);
    setMode("place");
    setEditHint("Pan the map or drag the crosshair onto the pivot point, then press Place here.");
  }

  // Pick-first: the type is fixed for the session; the right tool and
  // the draft color load, and the save form already knows its type.
  function beginDrawSession(session: DrawSession) {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;
    setPickerOpen(null);
    // Pins (a cemetery marker, a sinkhole): the crosshair, no drawing.
    if (session.kind === "pin" || (session.kind === "issue" && session.shape === "point")) {
      setDrawSession(session);
      setCrosshairPos(null);
      setMode("place");
      setEditHint("Pan the map or drag the crosshair onto the spot, then press Place here.");
      return;
    }
    const isLine = session.kind === "line" || (session.kind === "issue" && session.shape === "line");
    drawKindRef.current = isLine ? "line" : "boundary";
    setDrawSession(session);
    setMode("draw");
    draw.deleteAll();
    completedDrawIdsRef.current = new Set();
    setDrawingShape(true);
    applyDraftColor(map, draftColorFor(sessionColorKey(session)));
    if (isLine) {
      setEditHint("Tap along the line. Double tap the last point to finish.");
      draw.changeMode("draw_line_string");
    } else {
      setEditHint("Tap the map to add points. Double tap the last point to finish.");
      draw.changeMode("draw_polygon");
    }
  }

  // Asset placement picked up front: pin (crosshair), outline (polygon
  // draw in the asset look), or circle (crosshair center, then the
  // parametric editor).
  function beginAssetPlacement(assetType: AssetType, placement: AssetPlacement) {
    setPickerOpen(null);
    if (placement === "outline") {
      beginDrawSession({ kind: "asset_outline", assetType });
      return;
    }
    setCrosshairPos(null);
    setMode("place");
    if (placement === "circle") {
      placeForCircleRef.current = assetType;
      setEditHint("Pan the map or drag the crosshair onto the center, then press Place here.");
    } else {
      setPlaceAssetType(assetType);
      setEditHint("Pan the map or drag the crosshair to line it up, then press Place here.");
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
    const pinCapable =
      selected.entityType === "asset" ||
      selected.entityType === "cemetery" ||
      selected.entityType === "maintenance_issue";
    const isLineTarget =
      selected.entityType === "road" ||
      ((selected.entityType === "asset" || selected.entityType === "easement" ||
        selected.entityType === "maintenance_issue") &&
        (g?.type === "LineString" || g?.type === "MultiLineString"));
    setEditIsLine(isLineTarget);

    if (pinCapable && (isPoint || !g)) {
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
      ((target.entityType === "asset" || target.entityType === "maintenance_issue") &&
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
    if (placeForCircleRef.current) {
      // The crosshair placed a NEW circle footprint's center: into the
      // circle editor (Save asks for name and property).
      const assetType = placeForCircleRef.current;
      placeForCircleRef.current = null;
      setEditHint(null);
      openCircleEditor(
        null,
        assetType,
        { center: [center.lng, center.lat], diameterFt: DEFAULT_CIRCLE_DIAMETER_FT },
        {}
      );
      return;
    }
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
          addPolygons: [],
          cutPolygons: [],
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
    // Line easements arrive as a pending line, a cemetery marker as a
    // pending point; everything else a polygon.
    const geometry: Geometry | null =
      pendingPoly ??
      pendingLine ??
      (pendingPoint && payload.entityType === "cemetery"
        ? { type: "Point", coordinates: pendingPoint }
        : null);
    if (!geometry) return;
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
      if (payload.entityType === "cemetery") base.notes = payload.cemeteryNotes ?? null;
      if (payload.entityType === "timber_stand") {
        // Stand details captured inline in the save dialog: the stand
        // saves complete in one step.
        base.stand_type = payload.standType;
        base.species = payload.species;
        base.year_established = payload.yearEstablished;
        base.notes = payload.standNotes;
      }
      if (payload.entityType === "easement") {
        // Easement details inline the same way; property stays optional
        // (easements cross property lines, and one that BENEFITS this
        // property lies on a neighbor).
        base.easement_type = payload.easementType ?? "other";
        base.relationship = payload.relationship ?? "burdens_this_property";
        base.holder = payload.holder;
        base.recorded_ref = payload.recordedRef;
        base.expiration_date = payload.expirationDate;
        base.width_ft = payload.widthFt;
        base.elevation_ft = payload.elevationFt;
        base.program = payload.program;
        base.restrictions = payload.restrictions;
        base.notes = payload.easementNotes;
      }
    }
    const sel = await insertAndSetGeometry(
      ENTITY_TABLE[payload.entityType], base, payload.entityType, geometry
    );
    setSaving(false);
    if (sel) {
      resetDrawState();
      await loadData();
      setSelected(sel);
    }
  }

  // A maintenance issue: the pin, line, or area drawn in this session.
  async function saveNewIssue(payload: NewIssuePayload) {
    const geometry: Geometry | null =
      pendingPoly ??
      pendingLine ??
      (pendingPoint ? { type: "Point", coordinates: pendingPoint } : null);
    if (!geometry) return;
    setSaving(true);
    setSaveError(null);
    // The ag field the issue sits in, when its property has one under it.
    let fieldId: string | null = null;
    if (payload.propertyId) {
      const center =
        geometry.type === "Point"
          ? (geometry.coordinates as [number, number])
          : (() => {
              const mp = toMultiPolygon(geometry);
              return mp ? labelPointOf(mp) : null;
            })();
      if (center) {
        fieldId = suggestPropertyId(
          { type: "Point", coordinates: center },
          fields
            .filter((f) => f.property_id === payload.propertyId)
            .map((f) => ({ id: f.id, boundary: f.boundary_geojson }))
        );
      }
    }
    const sel = await insertAndSetGeometry(
      "maintenance_issues",
      {
        organization_id: orgId,
        property_id: payload.propertyId,
        field_id: fieldId,
        issue_type: payload.issueType,
        label: payload.label,
        notes: payload.notes,
        severity: payload.severity,
        status: "open",
      },
      "maintenance_issue",
      geometry
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

  // Outline-drawn footprint (shop, barn, pond): the polygon IS the asset.
  async function saveNewAssetOutline(payload: NewAssetPayload) {
    if (!pendingPoly) return;
    setSaving(true);
    setSaveError(null);
    const sel = await insertAndSetGeometry(
      "assets",
      { organization_id: orgId, property_id: payload.propertyId,
        name: payload.name, asset_type: payload.assetType },
      "asset", pendingPoly
    );
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

  // ---------------------------------------------------------------- print

  function openPrintSetup() {
    const map = mapRef.current;
    setSelected(null);
    // Prefill layers from the live toggles; parcel LABELS default off
    // in print even when the layer is on.
    setPrintLayers({
      property: visibility.property,
      parcel: visibility.parcel,
      field: visibility.field,
      pasture: visibility.pasture,
      wetland: visibility.wetland,
      timber_stand: visibility.timber_stand,
      road: visibility.road,
      easement: visibility.easement,
      asset: visibility.asset,
      cemetery: visibility.cemetery,
      maintenance: visibility.maintenance_issue,
      crops: cropsOn,
      entity: entityColorsOn,
    });
    // Title: the property name when the current view is one property,
    // else the organization name.
    let title = orgName ?? "";
    if (map) {
      const viewBounds = map.getBounds();
      if (viewBounds) {
        const inView = properties.filter((p) => {
          const box = bboxOf([p.boundary_geojson]);
          return (
            box &&
            box[0] < viewBounds.getEast() && box[2] > viewBounds.getWest() &&
            box[1] < viewBounds.getNorth() && box[3] > viewBounds.getSouth()
          );
        });
        if (inView.length === 1) title = inView[0].name;
      }
    }
    setPrintTitle(title);
    setPrintSubtitle(new Date().toLocaleDateString());
    setPrintError(null);
    // Item exclusions are per print session, never persisted.
    setPrintExcluded(new Set());
    setPrintDrawerOpen(false);
    setPrintItemFilter("");
    setPrintOpen(true);
  }

  function printFrameRect(): { left: number; top: number; width: number; height: number } | null {
    const el = containerRef.current;
    if (!el) return null;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const aspect = mapAspect(printOrientation);
    const maxW = cw * 0.86;
    const maxH = ch * 0.66;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    return { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
  }

  // Items whose geometry touches the print frame: what the property
  // chips and the Choose items drawer list (only in-frame items, so
  // dense orgs stay navigable).
  const printInFrame = useMemo(() => {
    if (!printOpen) return { items: [] as PrintItemInfo[], propertyIds: [] as string[] };
    const map = mapRef.current;
    const rect = printFrameRect();
    if (!map || !rect) return { items: [] as PrintItemInfo[], propertyIds: [] as string[] };
    const sw = map.unproject([rect.left, rect.top + rect.height]);
    const ne = map.unproject([rect.left + rect.width, rect.top]);
    const inFrame = (g: Geometry | null) => {
      const box = g ? bboxOf([g]) : null;
      return Boolean(
        box &&
          box[0] < ne.lng && box[2] > sw.lng &&
          box[1] < ne.lat && box[3] > sw.lat
      );
    };
    const items: PrintItemInfo[] = [];
    for (const [type, rows] of Object.entries(rowLists) as Array<
      [EntityType, AnyGeoRow[]]
    >) {
      if (!visibility[type]) continue;
      for (const row of rows) {
        if (!inFrame(geomOf(row))) continue;
        items.push({
          key: `${type}:${row.id}`,
          entityType: type,
          id: row.id,
          name: nameOf(row, type) || "(unnamed)",
          propertyId:
            type === "property"
              ? row.id
              : ((row as { property_id?: string | null }).property_id ?? null),
        });
      }
    }
    return {
      items,
      propertyIds: items.filter((i) => i.entityType === "property").map((i) => i.id),
    };
    // printViewVersion tracks map movement while the frame is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOpen, printViewVersion, printOrientation, rowLists, visibility]);

  // Property chip: excluding a property expands to its boundary plus
  // everything on it, so the flat exclusion set stays the one source
  // of truth for taps, chips, and the drawer alike.
  function togglePrintProperty(pid: string) {
    setPrintExcluded((prev) => {
      const next = new Set(prev);
      const keys = [`property:${pid}`];
      for (const [type, rows] of Object.entries(rowLists) as Array<
        [EntityType, AnyGeoRow[]]
      >) {
        if (type === "property") continue;
        for (const row of rows) {
          if ((row as { property_id?: string | null }).property_id === pid) {
            keys.push(`${type}:${row.id}`);
          }
        }
      }
      const isExcluded = next.has(`property:${pid}`);
      for (const key of keys) {
        if (isExcluded) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  function togglePrintKeys(keys: string[]) {
    setPrintExcluded((prev) => {
      const next = new Set(prev);
      const anyExcluded = keys.some((k) => next.has(k));
      for (const key of keys) {
        if (anyExcluded) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  // Excluded items vanish from the PDF, its legend, and its labels;
  // this filter is what makes the exclusion real at generation time.
  const printInc = useCallback(
    <T extends AnyGeoRow>(rows: T[], type: EntityType): T[] =>
      printExcluded.size === 0
        ? rows
        : rows.filter((r) => !printExcluded.has(`${type}:${r.id}`)),
    [printExcluded]
  );

  // Open issues whose geometry touches the framed extent, for the PDF's
  // "Maintenance issues" list (excluded items drop out like the rest).
  function printIssuesInFrame(
    frame: [[number, number], [number, number]]
  ): Array<{ title: string; severity: string | null; property: string | null }> {
    const [[w, s], [e, n]] = frame;
    const propName = new Map(properties.map((p) => [p.id, p.name]));
    return printInc(issues, "maintenance_issue")
      .filter((i) => i.status === "open")
      .filter((i) => {
        const box = bboxOf([i.geom_geojson]);
        return box && box[0] <= e && box[2] >= w && box[1] <= n && box[3] >= s;
      })
      .map((i) => ({
        title: issueTitle(i),
        severity: i.severity,
        property: i.property_id ? (propName.get(i.property_id) ?? null) : null,
      }));
  }

  function buildPrintLegend(flags: PrintLayerFlags): LegendEntry[] {
    const out: LegendEntry[] = [];
    const incCemeteries = printInc(cemeteries, "cemetery");
    const incIssues = printInc(issues, "maintenance_issue");
    const incParcels = printInc(parcels, "parcel");
    const incFields = printInc(fields, "field");
    const incPastures = printInc(pastures, "pasture");
    const incWetlands = printInc(wetlands, "wetland");
    const incTimber = printInc(timber, "timber_stand");
    const incRoads = printInc(roads, "road");
    const incEasements = printInc(easements, "easement");
    const incAssets = printInc(assets, "asset");
    if (flags.property && !flags.entity) {
      out.push({ label: "Property boundary", color: "#6b7280", kind: "outline" });
    }
    if (flags.property && flags.entity) {
      entities.forEach((e, i) =>
        out.push({ label: e.name, color: entityColor(i), kind: "outline" })
      );
    }
    if (flags.parcel && incParcels.length > 0) {
      out.push({ label: "Parcels", color: "#9ca3af", kind: "dash" });
    }
    if (flags.field && incFields.length > 0) {
      if (flags.crops) {
        for (const c of farmActivity.legend) {
          out.push({ label: c.label, color: c.color, kind: "fill" });
        }
      } else {
        out.push({ label: "Ag fields", color: KELLY, kind: "fill" });
      }
    }
    if (flags.pasture && incPastures.length > 0) {
      out.push({ label: LAND_TYPE_LABELS.pasture.plural, color: PASTURE_TAN, kind: "fill" });
    }
    if (flags.wetland && incWetlands.length > 0) {
      out.push({ label: "Wetlands", color: WETLAND_BLUE, kind: "fill" });
    }
    if (flags.timber_stand) {
      for (const type of Object.keys(STAND_TYPE_LABELS)) {
        if (incTimber.some((t) => ((t as TimberStandGeo).stand_type ?? "other") === type)) {
          out.push({
            label: STAND_TYPE_LABELS[type],
            color: STAND_TYPE_COLORS[type],
            kind: "fill",
          });
        }
      }
    }
    if (flags.road && incRoads.length > 0) {
      out.push({ label: "Roads", color: PINE, kind: "line" });
    }
    if (flags.easement) {
      for (const cat of categoriesPresent(incEasements)) {
        out.push({
          label: `${EASEMENT_CATEGORY_LABELS[cat]} easement`,
          color: EASEMENT_CATEGORY_COLORS[cat],
          kind:
            cat === "conservation"
              ? "hatch"
              : cat === "access_transport"
                ? "dash"
                : cat === "water"
                  ? "dotdash"
                  : "fill",
        });
      }
      if (incEasements.some((e) => e.easement_type === "railroad")) {
        out.push({ label: "Railroad", color: EASEMENT_STYLES.railroad.color, kind: "ticks" });
      }
    }
    if (flags.asset && incAssets.length > 0) {
      out.push({ label: "Assets", color: PINE, kind: "point" });
      if (
        incAssets.some(
          (a) =>
            a.asset_type === "irrigation_pivot" &&
            a.geom_geojson &&
            a.geom_geojson.type !== "Point"
        )
      ) {
        out.push({ label: "Pivot coverage", color: "#38bdf8", kind: "fill" });
      }
    }
    if (flags.cemetery && incCemeteries.length > 0) {
      out.push({ label: "Cemeteries", color: CEMETERY_VIOLET_DARK, kind: "fill" });
    }
    if (flags.maintenance && incIssues.length > 0) {
      if (incIssues.some((i) => i.status === "open" && i.severity !== "high")) {
        out.push({ label: "Open issue", color: ISSUE_COLORS.open.fill, kind: "point" });
      }
      if (incIssues.some((i) => i.status === "open" && i.severity === "high")) {
        out.push({ label: "High severity issue", color: ISSUE_COLORS.high.fill, kind: "point" });
      }
      if (incIssues.some((i) => i.status === "resolved")) {
        out.push({ label: "Resolved issue", color: ISSUE_COLORS.resolved.fill, kind: "point" });
      }
    }
    return out;
  }

  async function generatePrint() {
    const map = mapRef.current;
    const rect = printFrameRect();
    if (!map || !rect) return;
    const sw = map.unproject([rect.left, rect.top + rect.height]);
    const ne = map.unproject([rect.left + rect.width, rect.top]);
    setPrintError(null);
    setPrintBusy("Starting...");
    try {
      await generateMapPdf({
        bounds: [[sw.lng, sw.lat], [ne.lng, ne.lat]],
        orientation: printOrientation,
        title: printTitle.trim() || orgName || "Map",
        subtitle: printSubtitle.trim(),
        layers: printLayers,
        labels: printLabels,
        sources: {
          properties: propertiesFCWithEntity(printInc(properties, "property"), entities),
          parcels: rowsToFC(printInc(parcels, "parcel"), "parcel"),
          fields: fieldsFCWithCrops(printInc(fields, "field"), farmActivity.byField),
          pastures: rowsToFC(printInc(pastures, "pasture"), "pasture"),
          wetlands: rowsToFC(printInc(wetlands, "wetland"), "wetland"),
          timber: rowsToFC(printInc(timber, "timber_stand"), "timber_stand"),
          roads: rowsToFC(printInc(roads, "road"), "road"),
          easements: rowsToFC(printInc(easements, "easement"), "easement"),
          assets: rowsToFC(printInc(assets, "asset"), "asset"),
          cemeteries: rowsToFC(printInc(cemeteries, "cemetery"), "cemetery"),
          maintenance: rowsToFC(printInc(issues, "maintenance_issue"), "maintenance_issue"),
          cemeteryLabels: rowsToLabelFC(printInc(cemeteries, "cemetery"), "cemetery"),
          propertyLabels: rowsToLabelFC(printInc(properties, "property"), "property"),
          parcelLabels: rowsToLabelFC(printInc(parcels, "parcel"), "parcel"),
          fieldLabels: rowsToLabelFC(printInc(fields, "field"), "field"),
          pastureLabels: rowsToLabelFC(printInc(pastures, "pasture"), "pasture"),
          wetlandLabels: rowsToLabelFC(printInc(wetlands, "wetland"), "wetland"),
          timberLabels: rowsToLabelFC(printInc(timber, "timber_stand"), "timber_stand"),
          easementLabels: rowsToLabelFC(printInc(easements, "easement"), "easement"),
        },
        legend: buildPrintLegend(printLayers),
        issues: printLayers.maintenance
          ? printIssuesInFrame([[sw.lng, sw.lat], [ne.lng, ne.lat]])
          : [],
        onProgress: setPrintBusy,
      });
      setPrintOpen(false);
    } catch (err) {
      setPrintError(
        err instanceof Error ? err.message : "Could not generate the PDF."
      );
    } finally {
      setPrintBusy(null);
    }
  }

  function fitAll() {
    const map = mapRef.current;
    if (!map) return;
    const box = bboxOf([
      ...properties.map(geomOf), ...parcels.map(geomOf), ...fields.map(geomOf),
      ...pastures.map(geomOf), ...wetlands.map(geomOf), ...timber.map(geomOf),
      ...roads.map(geomOf), ...easements.map(geomOf), ...assets.map(geomOf),
      ...cemeteries.map(geomOf), ...issues.map(geomOf),
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

      {/* Print button (top right) */}
      {mode === "view" && !selected && !printOpen ? (
        <button
          onClick={openPrintSetup}
          className="absolute right-3 top-3 z-20 rounded-lg bg-white/95 px-3 py-2 text-sm font-semibold text-gray-800 shadow-md hover:bg-white"
        >
          Print
        </button>
      ) : null}

      {/* Print frame: the page-aspect print area; pan/zoom the map
          underneath to set the exact printed extent (WYSIWYG). */}
      {printOpen
        ? (() => {
            const rect = printFrameRect();
            if (!rect) return null;
            return (
              <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                <div
                  className="absolute rounded-sm border-2 border-white"
                  style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                    boxShadow: "0 0 0 100000px rgba(0,0,0,0.45)",
                  }}
                >
                  <span className="absolute -top-6 left-0 text-xs font-medium text-white drop-shadow">
                    Print area: pan and zoom, tap items to hide them
                  </span>
                  {printExcluded.size > 0 ? (
                    <button
                      onClick={() => setPrintExcluded(new Set())}
                      className="pointer-events-auto absolute -top-7 right-0 rounded-full bg-white/95 px-2.5 py-1 text-xs font-medium text-gray-800 shadow hover:bg-white"
                      title="Excluded items render ghosted and stay out of the PDF; tap to bring them all back"
                    >
                      {printExcluded.size} item{printExcluded.size === 1 ? "" : "s"} hidden
                      · clear
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })()
        : null}

      {/* Print setup panel */}
      {printOpen ? (
        <div className="pointer-events-auto fixed inset-x-0 bottom-16 z-30 max-h-[62%] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white p-4 shadow-2xl md:absolute md:inset-auto md:right-3 md:top-3 md:bottom-auto md:max-h-[calc(100%-2rem)] md:w-72 md:rounded-xl md:border">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Print map</h2>
            <button
              onClick={() => setPrintOpen(false)}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mt-2 space-y-2 text-sm">
            <label className="block text-xs font-medium text-gray-600">
              Title
              <input
                value={printTitle}
                onChange={(e) => setPrintTitle(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Subtitle / date
              <input
                value={printSubtitle}
                onChange={(e) => setPrintSubtitle(e.target.value)}
                className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <div className="flex gap-1.5">
              {(["landscape", "portrait"] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => setPrintOrientation(o)}
                  className={
                    "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium capitalize " +
                    (printOrientation === o
                      ? "border-kelly-500 bg-kelly-50 text-pine-900"
                      : "border-gray-300 text-gray-600")
                  }
                >
                  {o}
                </button>
              ))}
            </div>

            {printInFrame.propertyIds.length > 1 ? (
              <div>
                <p className="pt-1 text-xs font-medium text-gray-600">
                  Properties in frame (tap to include or exclude)
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {printInFrame.propertyIds.map((pid) => {
                    const property = properties.find((p) => p.id === pid);
                    const off = printExcluded.has(`property:${pid}`);
                    return (
                      <button
                        key={pid}
                        onClick={() => togglePrintProperty(pid)}
                        className={
                          "rounded-full border px-2.5 py-1 text-xs font-medium " +
                          (off
                            ? "border-gray-300 bg-gray-100 text-gray-400 line-through"
                            : "border-kelly-500 bg-kelly-50 text-pine-900")
                        }
                        title={
                          off
                            ? "Excluded from the print with everything on it; tap to restore"
                            : "Tap to exclude this whole property from the print"
                        }
                      >
                        {property?.name ?? "Property"}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {printExcluded.size > 0 ? (
              <button
                onClick={() => setPrintExcluded(new Set())}
                className="flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
              >
                {printExcluded.size} item{printExcluded.size === 1 ? "" : "s"} hidden ·
                clear all
              </button>
            ) : null}

            <div>
              <button
                onClick={() => setPrintDrawerOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Choose items
                <span className="text-gray-400">{printDrawerOpen ? "▴" : "▾"}</span>
              </button>
              {printDrawerOpen ? (
                <div className="mt-1 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  <input
                    value={printItemFilter}
                    onChange={(e) => setPrintItemFilter(e.target.value)}
                    placeholder="Filter items..."
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                  />
                  {(() => {
                    const filter = printItemFilter.trim().toLowerCase();
                    const visibleItems = printInFrame.items.filter(
                      (i) => !filter || i.name.toLowerCase().includes(filter)
                    );
                    if (visibleItems.length === 0) {
                      return (
                        <p className="text-xs text-gray-500">
                          Nothing in the frame{filter ? " matches" : ""}.
                        </p>
                      );
                    }
                    // Property > type > items, in-frame only.
                    const propertyOrder: Array<string | null> = [];
                    const byProperty = new Map<string | null, PrintItemInfo[]>();
                    for (const item of visibleItems) {
                      const pid = item.propertyId;
                      if (!byProperty.has(pid)) {
                        byProperty.set(pid, []);
                        propertyOrder.push(pid);
                      }
                      byProperty.get(pid)!.push(item);
                    }
                    const triState = (keys: string[]): "all" | "some" | "none" => {
                      const excludedCount = keys.filter((k) =>
                        printExcluded.has(k)
                      ).length;
                      if (excludedCount === 0) return "all";
                      return excludedCount === keys.length ? "none" : "some";
                    };
                    return propertyOrder.map((pid) => {
                      const groupItems = byProperty.get(pid)!;
                      const groupKeys = groupItems.map((i) => i.key);
                      const propertyName = pid
                        ? (properties.find((p) => p.id === pid)?.name ?? "Property")
                        : "No property";
                      const typeOrder: EntityType[] = [];
                      const byType = new Map<EntityType, PrintItemInfo[]>();
                      for (const item of groupItems) {
                        if (item.entityType === "property") continue;
                        if (!byType.has(item.entityType)) {
                          byType.set(item.entityType, []);
                          typeOrder.push(item.entityType);
                        }
                        byType.get(item.entityType)!.push(item);
                      }
                      const boundaryItem = groupItems.find(
                        (i) => i.entityType === "property"
                      );
                      return (
                        <div key={pid ?? "none"} className="space-y-1">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-gray-800">
                            <TriCheckbox
                              state={triState(groupKeys)}
                              onToggle={() => togglePrintKeys(groupKeys)}
                            />
                            {propertyName}
                          </label>
                          {boundaryItem ? (
                            <label className="ml-4 flex cursor-pointer items-center gap-1.5 text-xs text-gray-700">
                              <TriCheckbox
                                state={triState([boundaryItem.key])}
                                onToggle={() => togglePrintKeys([boundaryItem.key])}
                              />
                              Boundary outline
                            </label>
                          ) : null}
                          {typeOrder.map((type) => {
                            const typeItems = byType.get(type)!;
                            const typeKeys = typeItems.map((i) => i.key);
                            return (
                              <div key={type} className="ml-4 space-y-0.5">
                                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-700">
                                  <TriCheckbox
                                    state={triState(typeKeys)}
                                    onToggle={() => togglePrintKeys(typeKeys)}
                                  />
                                  {PRINT_TYPE_LABELS[type]}
                                </label>
                                {typeItems.map((item) => (
                                  <label
                                    key={item.key}
                                    className="ml-4 flex cursor-pointer items-center gap-1.5 text-xs text-gray-600"
                                  >
                                    <TriCheckbox
                                      state={triState([item.key])}
                                      onToggle={() => togglePrintKeys([item.key])}
                                    />
                                    <span className="truncate">{item.name}</span>
                                  </label>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : null}
            </div>

            <p className="pt-1 text-xs font-medium text-gray-600">
              Layers (labels toggle beside each)
            </p>
            <div className="space-y-1">
              {(
                [
                  ["property", "Property boundaries", true],
                  ["parcel", "Parcels", true],
                  ["field", "Ag fields", true],
                  ["timber_stand", "Timber stands", true],
                  ["pasture", LAND_TYPE_LABELS.pasture.plural, true],
                  ["wetland", "Wetlands", true],
                  ["road", "Roads", true],
                  ["easement", "Easements", true],
                  ["asset", "Assets", true],
                  ["cemetery", "Cemeteries", true],
                  ["maintenance", "Maintenance issues", false],
                ] as Array<[keyof PrintLabelFlags, string, boolean]>
              ).map(([key, label, hasLabels]) => (
                <div key={key} className="flex items-center gap-2 text-sm text-gray-800">
                  <label className="flex flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={printLayers[key]}
                      onChange={(e) =>
                        setPrintLayers((l) => ({ ...l, [key]: e.target.checked }))
                      }
                      className="h-4 w-4 accent-kelly-500"
                    />
                    {label}
                  </label>
                  {hasLabels && printLayers[key] ? (
                    <label
                      className="flex cursor-pointer items-center gap-1 text-xs text-gray-500"
                      title={`${label} labels on the printed map`}
                    >
                      <input
                        type="checkbox"
                        checked={printLabels[key]}
                        onChange={(e) =>
                          setPrintLabels((l) => ({ ...l, [key]: e.target.checked }))
                        }
                        className="h-3.5 w-3.5 accent-kelly-500"
                      />
                      labels
                    </label>
                  ) : null}
                </div>
              ))}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={printLayers.crops}
                  onChange={(e) =>
                    setPrintLayers((l) => ({ ...l, crops: e.target.checked }))
                  }
                  className="h-4 w-4 accent-kelly-500"
                />
                Color ag fields by crop
              </label>
              {entities.length > 1 ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={printLayers.entity}
                    onChange={(e) =>
                      setPrintLayers((l) => ({ ...l, entity: e.target.checked }))
                    }
                    className="h-4 w-4 accent-kelly-500"
                  />
                  Color boundaries by entity
                </label>
              ) : null}
            </div>

            {printError ? <p className="text-xs text-red-600">{printError}</p> : null}
            <button
              onClick={generatePrint}
              disabled={printBusy !== null}
              className="w-full rounded-lg bg-kelly-500 px-3 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              {printBusy ?? "Generate PDF"}
            </button>
            <p className="text-[11px] text-gray-500">
              Downloads a Letter PDF of the framed area with legend, scale
              bar, and satellite imagery at print resolution.
            </p>
          </div>
        </div>
      ) : null}

      {/* Left control column */}
      <div className="absolute left-3 top-3 z-20 flex w-36 flex-col gap-2">
        <LayerToggle visibility={visibility} onChange={setVisibility} />
        {visibility.easement && easements.length > 0 ? (
          <div className="rounded-lg bg-white/95 p-2 shadow-md">
            <p className="text-xs font-medium text-gray-800">Easements</p>
            <div className="mt-1 space-y-0.5">
              {categoriesPresent(easements).map((cat) => {
                const color = EASEMENT_CATEGORY_COLORS[cat];
                const hatch = cat === "conservation";
                return (
                  <p key={cat} className="flex items-center gap-1.5 text-xs text-gray-700">
                    <span
                      className="h-3 w-4 shrink-0 rounded-[2px]"
                      style={{
                        background: hatch
                          ? `repeating-linear-gradient(45deg, ${color}cc 0 1.5px, ${color}22 1.5px 4px)`
                          : color + "40",
                        border: `1.5px ${
                          cat === "utility" || cat === "access_transport" || cat === "water"
                            ? "dashed"
                            : "solid"
                        } ${color}`,
                      }}
                    />
                    {EASEMENT_CATEGORY_LABELS[cat]}
                  </p>
                );
              })}
              {easements.some((e) => e.easement_type === "railroad") ? (
                <p className="flex items-center gap-1.5 text-xs text-gray-700">
                  <span
                    className="h-1 w-4 shrink-0"
                    style={{
                      background: `repeating-linear-gradient(90deg, ${EASEMENT_STYLES.railroad.color} 0 1.5px, transparent 1.5px 4px)`,
                      borderTop: `1px solid ${EASEMENT_STYLES.railroad.color}`,
                      borderBottom: `1px solid ${EASEMENT_STYLES.railroad.color}`,
                    }}
                  />
                  Railroad
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
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
                    ["draw", "Draw (boundary, road, easement)"],
                    ["asset", "Asset (pin, outline, circle)"],
                    ["pivot", "Irrigation pivot (coverage)"],
                  ] as Array<["draw" | "asset" | "pivot", string]>
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
            const hasCuts = p.cutPolygons.length > 0;
            const chipClass =
              "flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-xs";
            const addClass =
              "rounded bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25";
            return (
              <div className="absolute inset-x-0 top-3 z-20 mx-auto w-fit max-w-[94%] rounded-lg bg-pine-900/95 px-3 py-2 text-white shadow-lg">
                {pivotDrawKind ? (
                  <>
                    <p className="text-xs">
                      {pivotDrawKind === "add"
                        ? "Draw the irrigated area to add (corner lobe, end gun reach); double tap the last point to finish. It joins the coverage."
                        : "Draw the area to cut out (pond, waterway, obstacle); double tap the last point to finish. It cuts a hole in the coverage."}
                    </p>
                    <div className="mt-1.5 flex justify-center">
                      <button
                        onClick={() => {
                          pivotShapeKindRef.current = null;
                          setPivotDrawKind(null);
                          drawRef.current?.deleteAll();
                        }}
                        className={addClass}
                      >
                        Cancel drawing
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs">
                      White handle moves the center, blue sets the radius
                      {p.fullCircle ? "" : ", green/red set the arc"}.
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
                          title="Wetted length in feet; draw added areas for end gun or corner reach"
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
                        {hasCuts
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
                        onClick={() => startPivotShape("add")}
                        title="Draw an irrigated area that joins the coverage (corner arm lobe, end gun reach, odd extension)"
                        className={addClass}
                      >
                        + Add area
                      </button>
                      <button
                        onClick={() => startPivotShape("cut")}
                        title="Draw an area to cut out of the coverage (pond, waterway, obstacle)"
                        className={addClass}
                      >
                        + Cut area
                      </button>
                    </div>
                    {p.addPolygons.length + p.cutPolygons.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                        {p.addPolygons.map((_, i) => (
                          <span key={`a${i}`} className={chipClass}>
                            Add {i + 1}
                            <button
                              onClick={() =>
                                setParams({
                                  addPolygons: p.addPolygons.filter((_, j) => j !== i),
                                })
                              }
                              className="font-semibold hover:text-red-300"
                              title="Remove this added area"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {p.cutPolygons.map((_, i) => (
                          <span key={`c${i}`} className={chipClass}>
                            Cut {i + 1}
                            <button
                              onClick={() =>
                                setParams({
                                  cutPolygons: p.cutPolygons.filter((_, j) => j !== i),
                                })
                              }
                              className="font-semibold hover:text-red-300"
                              title="Remove this cut area"
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

      {/* Circle footprint toolbar (hidden while the new-asset save
          dialog is up) */}
      {mode === "circle" && circleEdit && !pendingCircleSave
        ? (() => {
            const c = circleEdit.params;
            const sqFt = circleAreaSqFt(c.diameterFt);
            const isBin = circleEdit.assetType === "grain_bin";
            return (
              <div className="absolute inset-x-0 top-3 z-20 mx-auto w-fit max-w-[94%] rounded-lg bg-pine-900/95 px-3 py-2 text-white shadow-lg">
                <p className="text-xs">
                  White handle moves the center, blue sets the diameter.
                  {isBin ? " The diameter is the bin's diameter spec; typing it on the asset page resizes this circle too." : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    Diameter
                    <input
                      type="number"
                      step="any"
                      value={Math.round(c.diameterFt * 10) / 10}
                      onChange={(e) =>
                        setCircleEdit((edit) =>
                          edit
                            ? {
                                ...edit,
                                params: {
                                  ...edit.params,
                                  diameterFt: Math.max(
                                    MIN_CIRCLE_DIAMETER_FT,
                                    Number(e.target.value) || MIN_CIRCLE_DIAMETER_FT
                                  ),
                                },
                              }
                            : edit
                        )
                      }
                      className="w-20 rounded border-0 px-1.5 py-0.5 text-xs text-gray-900"
                    />
                    ft
                  </label>
                  <span className="text-xs tabular-nums">
                    {formatFootprint(sqFt, formatAcres, formatNumber)}
                    {circleAcres(c.diameterFt) >= 0.5
                      ? ""
                      : ` (${formatAcres(circleAcres(c.diameterFt))} ac)`}
                  </span>
                </div>
                <div className="mt-1.5 flex justify-center gap-2">
                  <button
                    onClick={saveCircle}
                    disabled={saving}
                    className="rounded bg-kelly-500 px-3 py-1 text-xs font-semibold hover:bg-kelly-600 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save circle"}
                  </button>
                  <button
                    onClick={cancelCircleEditor}
                    className="rounded bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25"
                  >
                    Cancel
                  </button>
                </div>
                {saveError ? <p className="mt-1 text-xs text-red-300">{saveError}</p> : null}
              </div>
            );
          })()
        : null}

      {/* Draw/edit/place toolbar */}
      {mode !== "view" && mode !== "pivot" && mode !== "circle" ? (
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
            {mode === "edit" && editTargetType && !editIsLine && POLYGON_TYPES.includes(editTargetType) ? (
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

      {/* Per-shape acreage while drawing a boundary: the shape in
          progress is never folded into the completed areas; the total
          appears only once there is more than one shape. */}
      {mode === "draw" && areaReadout && (areaReadout.active || areaReadout.completed.length > 0) ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-10 mx-auto w-fit max-w-[92%] rounded-lg bg-white/95 px-3 py-2 text-xs text-pine-900 shadow-md md:top-3">
          <p className="font-semibold">
            {areaReadout.active
              ? `Drawing: ${formatAcres(areaReadout.active.acres)} acres`
              : areaReadout.completed.length > 0
                ? "Tap to start the next area"
                : ""}
          </p>
          {areaReadout.completed.length > 0 ? (
            <p className="text-gray-600">
              {areaReadout.completed.map((s, i) => `Area ${i + 1}: ${formatAcres(s.acres)} acres`).join(", ")}
            </p>
          ) : null}
          {areaReadout.completed.length + (areaReadout.active ? 1 : 0) > 1 ? (
            <p className="mt-0.5 font-bold">Total: {formatAcres(areaReadout.total)} acres</p>
          ) : null}
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

      {/* Pick-first pickers */}
      {pickerOpen === "draw" ? (
        <DrawTypePicker onPick={beginDrawSession} onCancel={() => setPickerOpen(null)} />
      ) : null}
      {pickerOpen === "asset" ? (
        <AssetPlacePicker onPick={beginAssetPlacement} onCancel={() => setPickerOpen(null)} />
      ) : null}

      {/* Save dialogs: the session's type is fixed, so each form opens
          already set to it with its inline fields. */}
      {drawSession?.kind === "issue" && (pendingPoly || pendingLine || pendingPoint) && !pendingExtraDraw ? (
        <NewIssueDialog
          issueType={drawSession.issueType}
          shape={drawSession.shape}
          approxAcres={pendingPoly ? approxAcres(pendingPoly) : null}
          properties={properties}
          suggestedPropertyId={pendingPoly ? suggestedForPoly : pendingLine ? suggestedForLine : suggestedForPoint}
          saving={saving}
          error={saveError}
          onSave={saveNewIssue}
          onCancel={pendingPoly ? cancelBoundarySession : resetDrawState}
        />
      ) : null}
      {drawSession?.kind === "pin" && pendingPoint && mode === "place" ? (
        <NewBoundaryDialog
          fixedType="cemetery"
          shape="polygon"
          approxAcres={null}
          properties={properties}
          suggestedPropertyId={suggestedForPoint}
          saving={saving}
          error={saveError}
          onSave={saveNewBoundary}
          onCancel={resetDrawState}
        />
      ) : null}
      {mode === "draw" && drawSession && drawSession.kind !== "asset_outline" && drawSession.kind !== "issue" && drawSession.kind !== "pin" &&
      (drawSession.entityType === "easement"
        ? pendingPoly || pendingLine
        : drawSession.kind === "boundary" && pendingPoly) ? (
        <NewBoundaryDialog
          fixedType={drawSession.entityType as BoundaryType}
          shape={drawSession.kind === "line" ? "line" : "polygon"}
          approxAcres={pendingPoly ? approxAcres(pendingPoly) : null}
          areaCount={pendingPoly ? pendingPoly.coordinates.length : 1}
          approxLengthFt={pendingLine ? approxLengthFt(pendingLine) : null}
          properties={properties}
          suggestedPropertyId={pendingPoly ? suggestedForPoly : suggestedForLine}
          saving={saving}
          error={saveError}
          onSave={saveNewBoundary}
          onCancel={pendingPoly ? cancelBoundarySession : resetDrawState}
          onAddArea={() => startBoundaryOp("add")}
          onCutArea={() => startBoundaryOp("subtract")}
          hidden={pendingExtraDraw}
        />
      ) : null}
      {pendingLine && mode === "draw" && drawSession?.kind === "line" &&
      drawSession.entityType !== "easement" ? (
        <NewLineDialog
          fixedKind={drawSession.entityType}
          properties={properties}
          suggestedPropertyId={suggestedForLine}
          saving={saving}
          error={saveError}
          onSave={saveNewLine}
          onCancel={resetDrawState}
        />
      ) : null}
      {pendingPoly && mode === "draw" && drawSession?.kind === "asset_outline" && !pendingExtraDraw ? (
        <NewAssetDialog
          properties={properties}
          suggestedPropertyId={suggestedForPoly}
          fixedType={drawSession.assetType}
          saving={saving}
          error={saveError}
          onSave={saveNewAssetOutline}
          onCancel={cancelBoundarySession}
        />
      ) : null}
      {pendingPoint && mode === "place" && !drawSession ? (
        <NewAssetDialog
          properties={properties}
          suggestedPropertyId={suggestedForPoint}
          fixedType={placeAssetType}
          saving={saving}
          error={saveError}
          onSave={saveNewAsset}
          onCancel={resetDrawState}
        />
      ) : null}
      {pendingCircleSave && mode === "circle" && circleEdit ? (
        <NewAssetDialog
          properties={properties}
          suggestedPropertyId={suggestPropertyId(
            { type: "Point", coordinates: circleEdit.params.center },
            matchableProperties
          )}
          fixedType={circleEdit.assetType}
          saving={saving}
          error={saveError}
          onSave={saveNewCircleAsset}
          onCancel={() => setPendingCircleSave(false)}
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
          onCircleFootprint={startCircleEditor}
          onChanged={loadData}
        />
      ) : null}
    </div>
  );
}
