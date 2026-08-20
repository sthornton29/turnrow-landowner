import { describe, expect, it } from "vitest";
import { verifyMatches, type MatchableEntity, type MatchableParcel, type MatchableProperty } from "./documentMatch";

const properties: MatchableProperty[] = [
  { id: "river", name: "River Place", county: "Lawrence", state: "AL", fsa_numbers: ["1234"], acres: 320 },
  { id: "hill", name: "Hill Farm", county: "Colbert", state: "AL", fsa_numbers: ["2222"], acres: 80 },
  { id: "hill2", name: "Hill Farm East", county: "Colbert", state: "AL", fsa_numbers: [], acres: 40 },
];
const parcels: MatchableParcel[] = [
  { id: "p1", property_id: "river", parcel_number: "12-03-07-0-000-004.000" },
  { id: "p2", property_id: "hill", parcel_number: "05-01-02-0-000-001.000" },
];
const entities: MatchableEntity[] = [
  { id: "llc", name: "Thornton Land LLC", aliases: ["THORNTON LAND L L C", "THORNTON STUART ETAL"] },
];
const propertyEntity = { river: "llc", hill: null, hill2: null };

describe("verifyMatches", () => {
  it("verifies a parcel claim when the parcel sits on that property (separator-insensitive)", () => {
    const r = verifyMatches(
      [{ name: "River Place", confidence: "high", signal: "parcel", value: "120307 0 000 004.000", reason: "" }],
      { parcel_numbers: ["120307 0 000 004.000"] },
      properties, parcels, entities, null, propertyEntity
    );
    expect(r.verified.map((v) => v.propertyId)).toEqual(["river"]);
    expect(r.verified[0].reasons[0]).toBe("parcel 12-03-07-0-000-004.000 matches River Place");
    expect(r.downgraded).toEqual([]);
  });

  it("downgrades a parcel claim whose number is on a different property", () => {
    const r = verifyMatches(
      [{ name: "River Place", confidence: "high", signal: "parcel", value: "05-01-02-0-000-001.000", reason: "" }],
      { parcel_numbers: ["05-01-02-0-000-001.000"] },
      properties, parcels, entities, null, propertyEntity
    );
    expect(r.verified).toEqual([]);
    expect(r.downgraded[0]).toMatchObject({ name: "River Place", signal: "parcel" });
  });

  it("verifies and downgrades FSA farm claims by digits", () => {
    const ok = verifyMatches(
      [{ name: "River Place", confidence: "high", signal: "fsa", value: "Farm #1234", reason: "" }],
      {}, properties, parcels, entities, null, propertyEntity
    );
    expect(ok.verified[0].propertyId).toBe("river");
    const bad = verifyMatches(
      [{ name: "River Place", confidence: "high", signal: "fsa", value: "9999", reason: "" }],
      {}, properties, parcels, entities, null, propertyEntity
    );
    expect(bad.verified).toEqual([]);
    expect(bad.downgraded[0].signal).toBe("fsa");
  });

  it("verifies a name claim only when the property name is actually on the page", () => {
    const ok = verifyMatches(
      [{ name: "Hill Farm", confidence: "medium", signal: "name", value: "the Hill Farm tract", reason: "" }],
      { place_names: ["Hill Farm"] }, properties, parcels, entities, null, propertyEntity
    );
    expect(ok.verified[0].propertyId).toBe("hill");
    const bad = verifyMatches(
      [{ name: "Hill Farm", confidence: "medium", signal: "name", value: "", reason: "" }],
      { place_names: ["Somewhere else"] }, properties, parcels, entities, null, propertyEntity
    );
    expect(bad.verified).toEqual([]);
  });

  it("verifies an alias claim against the entity that holds the property", () => {
    const r = verifyMatches(
      [{ name: "River Place", confidence: "high", signal: "alias", value: "Thornton Stuart et al", reason: "" }],
      { owner_names: ["Thornton Stuart et al"] },
      properties, parcels, entities, { name: "Thornton Land LLC", value: "Thornton Stuart et al", reason: "" }, propertyEntity
    );
    expect(r.verified[0].propertyId).toBe("river");
    expect(r.entity?.entityId).toBe("llc");
    expect(r.entity?.why).toContain("alias");
  });

  it("downgrades an alias claim on a property with no entity match", () => {
    const r = verifyMatches(
      [{ name: "Hill Farm", confidence: "high", signal: "alias", value: "Thornton Stuart", reason: "" }],
      {}, properties, parcels, entities, null, propertyEntity
    );
    expect(r.verified).toEqual([]);
    expect(r.downgraded[0].signal).toBe("alias");
  });

  it("county only counts when the property is the only one in that county", () => {
    const unique = verifyMatches(
      [{ name: "River Place", confidence: "low", signal: "county", value: "Lawrence", reason: "" }],
      { counties: ["Lawrence"], states: ["AL"] }, properties, parcels, entities, null, propertyEntity
    );
    expect(unique.verified[0].propertyId).toBe("river");
    const ambiguous = verifyMatches(
      [{ name: "Hill Farm", confidence: "low", signal: "county", value: "Colbert", reason: "" }],
      { counties: ["Colbert"] }, properties, parcels, entities, null, propertyEntity
    );
    expect(ambiguous.verified).toEqual([]);
    expect(ambiguous.downgraded[0].name).toBe("Hill Farm");
  });

  it("ignores names that are not the owner's properties", () => {
    const r = verifyMatches(
      [{ name: "Somebody Else Farm", confidence: "high", signal: "parcel", value: "1", reason: "" }],
      {}, properties, parcels, entities, null, propertyEntity
    );
    expect(r.verified).toEqual([]);
    expect(r.downgraded[0].reason).toBe("Not one of your properties");
  });
});
