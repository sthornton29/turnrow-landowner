import { describe, expect, it } from "vitest";
import { defaultBoundaryMode, effectiveBoundaryMode, importMapFocus, importReturnTo } from "@/lib/importBoundary";

describe("county import: the property boundary", () => {
  it("grows a boundary the property already has, and sets one where there is none", () => {
    expect(defaultBoundaryMode(true)).toBe("add");
    expect(defaultBoundaryMode(false)).toBe("merge");
  });

  it("treats add as the merged outline when there is no boundary to add to", () => {
    expect(effectiveBoundaryMode("add", false)).toBe("merge");
    expect(effectiveBoundaryMode("add", true)).toBe("add");
    expect(effectiveBoundaryMode("merge", true)).toBe("merge");
    expect(effectiveBoundaryMode("keep", true)).toBe("keep");
    expect(effectiveBoundaryMode("keep", false)).toBe("keep");
  });
});

describe("county import: View on map", () => {
  it("zooms to the parcel when one parcel was imported", () => {
    expect(importMapFocus(["p1"], "prop")).toBe("parcel:p1");
    // The same parcel listed twice is still one parcel.
    expect(importMapFocus(["p1", "p1"], "prop")).toBe("parcel:p1");
  });

  it("shows the property when several parcels went into it", () => {
    expect(importMapFocus(["p1", "p2"], "prop")).toBe("property:prop");
  });

  it("falls back to a parcel when there is no property, and to nothing when there is neither", () => {
    expect(importMapFocus(["p1", "p2"], null)).toBe("parcel:p1");
    expect(importMapFocus([], "prop")).toBe("property:prop");
    expect(importMapFocus([""], null)).toBeNull();
  });
});

describe("county import: the way back", () => {
  it("returns to Property Taxes on the year the user was looking at", () => {
    expect(importReturnTo("taxes", "2026")).toEqual({ href: "/taxes?year=2026", label: "Back to Property Taxes" });
    expect(importReturnTo("taxes", undefined)).toEqual({ href: "/taxes", label: "Back to Property Taxes" });
  });

  it("never builds a link from text it does not know", () => {
    expect(importReturnTo("taxes", "2026&x=//evil.example")?.href).toBe("/taxes");
    expect(importReturnTo("//evil.example", "2026")).toBeNull();
    expect(importReturnTo(undefined, undefined)).toBeNull();
  });
});
