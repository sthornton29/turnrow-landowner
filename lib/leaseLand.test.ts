import { describe, expect, it } from "vitest";
import {
  matchLeaseLand,
  type ExtractedLeaseLand,
  type MatchableProperty,
} from "./leaseLand";

const properties: MatchableProperty[] = [
  { id: "river", name: "River Place", county: "Lawrence", acres: 412.7, fsa_numbers: ["1234"] },
  { id: "blythe", name: "Blythe Farm", county: "Morgan", acres: 250.0, fsa_numbers: null },
  { id: "home", name: "Home Place", county: "Lawrence", acres: 80.0, fsa_numbers: ["5678", "5679"] },
];

const parcels = [
  { property_id: "blythe", parcel_number: "02 04 18 0 000 007.000" },
  { property_id: "home", parcel_number: "12 03 05 0 000 001.000" },
];

const land = (over: Partial<ExtractedLeaseLand>): ExtractedLeaseLand => ({
  description: "",
  acres: null,
  county: null,
  state: null,
  fsa_numbers: [],
  parcel_numbers: [],
  ...over,
});

describe("matchLeaseLand", () => {
  it("matches on FSA number regardless of formatting", () => {
    const result = matchLeaseLand(
      land({ description: "the farm", fsa_numbers: ["FSA #1234"] }),
      properties,
      parcels
    );
    expect(result).toEqual({ propertyId: "river", strong: true });
  });

  it("matches on parcel number with different formatting", () => {
    const result = matchLeaseLand(
      land({ description: "tract one", parcel_numbers: ["0204180000007000"] }),
      properties,
      parcels
    );
    expect(result).toEqual({ propertyId: "blythe", strong: true });
  });

  it("matches on farm name plus acreage as a soft suggestion", () => {
    const result = matchLeaseLand(
      land({
        description: "approximately 250 acres known as the Blythe farm on CR 34",
        acres: 248,
        county: "Morgan County, Alabama",
      }),
      properties,
      parcels
    );
    expect(result.propertyId).toBe("blythe");
    expect(result.strong).toBe(false);
  });

  it("returns no match when the evidence is weak", () => {
    const result = matchLeaseLand(
      land({ description: "the Johnson 160 in Limestone County", acres: 160 }),
      properties,
      parcels
    );
    expect(result.propertyId).toBeNull();
  });

  it("prefers the identifier match over a name coincidence", () => {
    // Description mentions River Place by name, but the FSA number
    // belongs to Home Place: the identifier wins.
    const result = matchLeaseLand(
      land({ description: "River Place fields", fsa_numbers: ["5678"] }),
      properties,
      parcels
    );
    expect(result).toEqual({ propertyId: "home", strong: true });
  });
});
