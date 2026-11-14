// Timber Scan proposals after the raster work is done: totals, and
// keeping a stored scan honest about what has been saved since it ran.

import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import area from "@turf/area";
import difference from "@turf/difference";
import { ACRE_M2, type TimberClass } from "./raster";
import type { ScanProposal, ScanResult, ScanSummary } from "./types";

type AreaFeature = Feature<Polygon | MultiPolygon>;

const feat = (geometry: Polygon | MultiPolygon): AreaFeature => ({
  type: "Feature",
  properties: {},
  geometry,
});
const fc = (features: AreaFeature[]): FeatureCollection<Polygon | MultiPolygon> => ({
  type: "FeatureCollection",
  features,
});
const round1 = (n: number) => Math.round(n * 10) / 10;

// A proposal smaller than this is noise at 30 meter pixels.
export const MIN_PROPOSAL_ACRES = 0.2;

export function summarizeProposals(proposals: ScanProposal[]): ScanSummary {
  const byClass = { pine: 0, hardwood: 0, mixed: 0, wetland: 0 } as Record<TimberClass, number>;
  for (const p of proposals) byClass[p.cls] = round1(byClass[p.cls] + p.acres);
  return {
    woodedAcres: round1(proposals.reduce((s, p) => s + p.acres, 0)),
    byClass,
  };
}

// Trim a stored scan against the stands saved since it ran.
//
// A fresh scan never proposes ground that is already a saved stand, but
// scans are cached per property and year. Without this, saving three of
// five proposals and reopening the page offered all five again, and
// accepting them a second time created overlapping stands and doubled
// the property's timber acres.
//
// Saved ground is cut out of each proposal, what is left under the
// minimum is dropped, and the totals are recomputed. Vector work only
// (no call to USDA), so it is cheap to do on every request.
export function withoutSavedStands(
  result: ScanResult,
  savedStands: AreaFeature | null
): ScanResult {
  if (!savedStands || !Array.isArray(result.proposals)) return result;
  const proposals: ScanProposal[] = [];
  for (const p of result.proposals) {
    let remaining: AreaFeature | null;
    try {
      remaining = difference(fc([feat(p.geometry), savedStands]));
    } catch {
      // A shape that cannot be subtracted from: keep the proposal as it
      // was rather than hide ground the person may still need to map.
      proposals.push(p);
      continue;
    }
    if (!remaining) continue;
    const acres = round1(area(remaining) / ACRE_M2);
    if (acres < MIN_PROPOSAL_ACRES) continue;
    // An untouched proposal keeps its stored figures; a trimmed one gets
    // its new shape and area (its overlap with ag fields can only have
    // shrunk, so it is scaled down with it).
    const trimmed = Math.abs(acres - p.acres) >= 0.1;
    proposals.push(
      trimmed
        ? {
            ...p,
            geometry: remaining.geometry,
            acres,
            agOverlapAcres: p.acres > 0 ? round1(p.agOverlapAcres * (acres / p.acres)) : 0,
          }
        : p
    );
  }
  proposals.sort((a, b) => b.acres - a.acres);
  return { ...result, summary: summarizeProposals(proposals), proposals };
}
