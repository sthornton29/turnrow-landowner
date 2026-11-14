import { describe, expect, it } from "vitest";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import area from "@turf/area";
import { candidateYears } from "./cdl";
import { summarizeProposals, withoutSavedStands } from "./proposals";
import { ACRE_M2 } from "./raster";
import type { ScanProposal, ScanResult } from "./types";

// A square of roughly `acres` acres with its south-west corner at
// (lon, lat), near Moulton, Alabama.
function square(lon: number, lat: number, acres: number): Polygon {
  const sideM = Math.sqrt(acres * ACRE_M2);
  const dLat = sideM / 110_950;
  const dLon = sideM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: "Polygon",
    coordinates: [[[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat], [lon, lat]]],
  };
}
const feat = (geometry: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> => ({
  type: "Feature",
  properties: {},
  geometry,
});
const acresOf = (g: Polygon | MultiPolygon) => Math.round((area(feat(g)) / ACRE_M2) * 10) / 10;

function proposal(id: string, cls: ScanProposal["cls"], geometry: Polygon): ScanProposal {
  return {
    id,
    cls,
    geometry,
    acres: acresOf(geometry),
    percents: [{ cls, percent: 100 }],
    dominant: cls,
    agOverlapAcres: 0,
  };
}

function scan(proposals: ScanProposal[]): ScanResult {
  return {
    year: 2025,
    generated_at: "2026-08-16T00:00:00.000Z",
    summary: summarizeProposals(proposals),
    proposals,
  };
}

describe("withoutSavedStands", () => {
  const pineA = square(-87.30, 34.48, 60);
  const pineB = square(-87.28, 34.48, 40);
  const hardwood = square(-87.26, 34.48, 80);

  it("returns the scan untouched when nothing has been saved", () => {
    const result = scan([proposal("a", "pine", pineA), proposal("b", "pine", pineB)]);
    expect(withoutSavedStands(result, null)).toBe(result);
  });

  it("stops offering a proposal that has been saved as a stand", () => {
    const result = scan([
      proposal("a", "pine", pineA),
      proposal("b", "pine", pineB),
      proposal("c", "hardwood", hardwood),
    ]);
    expect(result.summary.woodedAcres).toBeCloseTo(180, 0);

    // The owner accepted A and C: they are saved stands now.
    const saved: Feature<MultiPolygon> = {
      type: "Feature",
      properties: {},
      geometry: { type: "MultiPolygon", coordinates: [pineA.coordinates, hardwood.coordinates] },
    };
    const after = withoutSavedStands(result, saved);
    expect(after.proposals.map((p) => p.id)).toEqual(["b"]);
    expect(after.summary.woodedAcres).toBeCloseTo(40, 0);
    expect(after.summary.byClass.pine).toBeCloseTo(40, 0);
    expect(after.summary.byClass.hardwood).toBe(0);
  });

  it("trims a proposal that a saved stand only partly covers", () => {
    const whole = square(-87.30, 34.48, 100);
    // A saved stand over the western half (same south-west corner, half
    // the width).
    const ring = whole.coordinates[0];
    const midLon = (ring[0][0] + ring[1][0]) / 2;
    const westHalf: Polygon = {
      type: "Polygon",
      coordinates: [[[ring[0][0], ring[0][1]], [midLon, ring[0][1]], [midLon, ring[2][1]], [ring[0][0], ring[2][1]], [ring[0][0], ring[0][1]]]],
    };
    const before = { ...proposal("a", "mixed", whole), agOverlapAcres: 10 };
    const after = withoutSavedStands(scan([before]), feat(westHalf));
    expect(after.proposals).toHaveLength(1);
    expect(after.proposals[0].acres).toBeCloseTo(50, 0);
    expect(after.proposals[0].agOverlapAcres).toBeCloseTo(5, 0);
    expect(acresOf(after.proposals[0].geometry)).toBeCloseTo(50, 0);
    expect(after.summary.woodedAcres).toBeCloseTo(50, 0);
  });

  it("drops the sliver left when a saved stand covers nearly all of a proposal", () => {
    const whole = square(-87.30, 34.48, 30);
    const ring = whole.coordinates[0];
    // Saved stand stops a hair short of the east edge.
    const almostLon = ring[0][0] + (ring[1][0] - ring[0][0]) * 0.999;
    const almost: Polygon = {
      type: "Polygon",
      coordinates: [[[ring[0][0], ring[0][1]], [almostLon, ring[0][1]], [almostLon, ring[2][1]], [ring[0][0], ring[2][1]], [ring[0][0], ring[0][1]]]],
    };
    const after = withoutSavedStands(scan([proposal("a", "pine", whole)]), feat(almost));
    expect(after.proposals).toHaveLength(0);
    expect(after.summary.woodedAcres).toBe(0);
  });

  it("leaves proposals elsewhere on the property exactly as stored", () => {
    const far = proposal("b", "pine", pineB);
    const after = withoutSavedStands(scan([far]), feat(pineA));
    expect(after.proposals[0]).toBe(far);
  });
});

describe("candidateYears", () => {
  it("starts with last year: this year's layer is not published until next year", () => {
    expect(candidateYears(new Date(2026, 10, 14))).toEqual([2025, 2024, 2023]);
  });
  it("never asks for the current year", () => {
    expect(candidateYears(new Date(2027, 0, 2))).not.toContain(2027);
    expect(candidateYears(new Date(2027, 0, 2))[0]).toBe(2026);
  });
});
