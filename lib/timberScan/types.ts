// Shared shapes for Timber Scan results (server route <-> review UI,
// and the cached jsonb in timber_scans.result).

import type { MultiPolygon, Polygon } from "geojson";
import type { TimberClass } from "./raster";

export interface ScanProposal {
  id: string;
  cls: TimberClass;
  geometry: Polygon | MultiPolygon;
  acres: number; // pre-import display; PostGIS recomputes on save
  percents: Array<{ cls: TimberClass; percent: number }>;
  dominant: TimberClass | null;
  // Overlap with saved ag fields, acres: usually a young pine planting
  // on former cropland or a raster edge error; the user decides.
  agOverlapAcres: number;
}

export interface ScanSummary {
  woodedAcres: number;
  byClass: Record<TimberClass, number>;
}

export interface ScanResult {
  year: number;
  generated_at: string;
  summary: ScanSummary;
  proposals: ScanProposal[];
}
