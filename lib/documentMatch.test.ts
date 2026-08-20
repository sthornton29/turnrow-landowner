import { describe, expect, it } from "vitest";
import {
  CONFIDENT_SCORE,
  isConfident,
  nameMentioned,
  suggestProperties,
  type MatchableParcel,
  type MatchableProperty,
} from "./documentMatch";

const props: MatchableProperty[] = [
  { id: "home", name: "Home Place", county: "Lawrence", state: "AL", fsa_numbers: ["1234"], acres: 160.2 },
  { id: "river", name: "River Farm", county: "Lawrence", state: "AL", fsa_numbers: null, acres: 412.0 },
  { id: "ms", name: "Delta Tract", county: "Bolivar", state: "MS", fsa_numbers: ["9876"], acres: 160.0 },
];
const parcels: MatchableParcel[] = [
  { id: "p1", property_id: "home", parcel_number: "12-03-07-0-000-004.000" },
  { id: "p2", property_id: "river", parcel_number: "12 03 08 0 000 001.000" },
];

describe("suggestProperties", () => {
  it("matches parcel numbers regardless of separators (+60)", () => {
    const s = suggestProperties({ parcel_numbers: ["120307 0 000 004.000"] }, props, parcels);
    expect(s[0].propertyId).toBe("home");
    expect(s[0].score).toBe(60);
    expect(s[0].reasons[0]).toBe("Parcel 12-03-07-0-000-004.000 is on this property");
    expect(isConfident(s[0])).toBe(true);
  });

  it("matches FSA farm numbers (+50)", () => {
    const s = suggestProperties({ fsa_farm_numbers: ["FSA 9876"] }, props, parcels);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ propertyId: "ms", score: 50 });
  });

  it("matches the property name as a whole word (+30)", () => {
    const s = suggestProperties({ place_names: ["the River Farm tract"] }, props, parcels);
    expect(s.map((x) => x.propertyId)).toEqual(["river"]);
    expect(s[0].score).toBe(30);
    expect(nameMentioned("Home Place", "Homer Placeholder")).toBe(false);
  });

  it("county adds 10 and state adds 2 more", () => {
    const s = suggestProperties({ counties: ["Lawrence County"], states: ["Alabama"] }, props, parcels);
    expect(s).toHaveLength(2);
    for (const x of s) {
      expect(x.score).toBe(12);
      expect(x.reasons[0]).toContain("Same county and state");
    }
    const countyOnly = suggestProperties({ counties: ["lawrence"] }, props, parcels);
    expect(countyOnly[0].score).toBe(10);
  });

  it("acres within 10 percent add 8", () => {
    const s = suggestProperties({ acres: 158 }, props, parcels);
    expect(s.map((x) => x.propertyId).sort()).toEqual(["home", "ms"]);
    expect(s[0].score).toBe(8);
    expect(suggestProperties({ acres: 100 }, props, parcels)).toEqual([]);
  });

  it("sums rules and orders by score, dropping zero scores", () => {
    const s = suggestProperties(
      { counties: ["Lawrence"], states: ["AL"], fsa_farm_numbers: ["1234"], acres: 160 },
      props,
      parcels
    );
    expect(s.map((x) => x.propertyId)).toEqual(["home", "river", "ms"]);
    expect(s[0].score).toBe(50 + 12 + 8);
    expect(s[1].score).toBe(12);
    expect(s[2].score).toBe(8); // acres only
    expect(isConfident(s[1])).toBe(false);
    expect(CONFIDENT_SCORE).toBe(50);
  });

  it("handles missing hints", () => {
    expect(suggestProperties(null, props, parcels)).toEqual([]);
    expect(suggestProperties({}, props, parcels)).toEqual([]);
  });
});
