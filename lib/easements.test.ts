import { describe, expect, it } from "vitest";
import {
  EASEMENT_CATEGORIES,
  EASEMENT_CATEGORY,
  EASEMENT_CATEGORY_COLORS,
  EASEMENT_CATEGORY_LABELS,
  EASEMENT_STYLES,
  EASEMENT_TYPES,
  EASEMENT_TYPE_LABELS,
  categoriesPresent,
  easementCategory,
  easementStyle,
  migrateLegacyEasementRow,
} from "./easements";
import { STAND_TYPE_COLORS } from "./assetTypes";

// The exact list migration 0019 allows.
const SQL_TYPES = [
  "powerline", "pipeline", "waterline_sewer", "telecom_fiber",
  "access_row", "public_road_row", "railroad",
  "drainage", "flowage",
  "conservation",
  "cemetery_access", "construction_temp", "solar_wind", "other",
];

describe("easement type catalog", () => {
  it("matches the migration's check constraint exactly", () => {
    expect([...EASEMENT_TYPES].sort()).toEqual([...SQL_TYPES].sort());
  });

  it("styles, labels, and categorizes every type", () => {
    for (const t of EASEMENT_TYPES) {
      expect(EASEMENT_TYPE_LABELS[t]).toBeTruthy();
      expect(EASEMENT_CATEGORY[t]).toBeTruthy();
      const s = EASEMENT_STYLES[t];
      expect(s).toBeTruthy();
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.fillOpacity).toBeGreaterThan(0);
      expect(s.fillOpacity).toBeLessThan(1);
      expect(["solid", "dashed", "dotted"]).toContain(s.cssBorder);
    }
  });

  it("every category has a label and a swatch color", () => {
    for (const c of EASEMENT_CATEGORIES) {
      expect(EASEMENT_CATEGORY_LABELS[c]).toBeTruthy();
      expect(EASEMENT_CATEGORY_COLORS[c]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const used = new Set(Object.values(EASEMENT_CATEGORY));
    expect([...used].sort()).toEqual([...EASEMENT_CATEGORIES].sort());
  });

  it("groups types into the agreed families", () => {
    expect(easementCategory("powerline")).toBe("utility");
    expect(easementCategory("telecom_fiber")).toBe("utility");
    expect(easementCategory("railroad")).toBe("access_transport");
    expect(easementCategory("flowage")).toBe("water");
    expect(easementCategory("conservation")).toBe("conservation");
    expect(easementCategory("solar_wind")).toBe("neutral");
    expect(easementCategory(null)).toBe("neutral");
    expect(easementCategory("garbage")).toBe("neutral");
  });

  it("keeps the pre-0019 utility treatments", () => {
    expect(EASEMENT_STYLES.powerline.color).toBe("#dc2626");
    expect(EASEMENT_STYLES.pipeline.color).toBe("#f97316");
  });

  it("special treatments: railroad ticks, conservation hatch, flowage fill", () => {
    expect(EASEMENT_STYLES.railroad.ticks).toBe(true);
    expect(EASEMENT_STYLES.conservation.hatch).toBe(true);
    expect(EASEMENT_STYLES.flowage.fillOpacity).toBeGreaterThan(
      EASEMENT_STYLES.drainage.fillOpacity
    );
    // Conservation violet is not the mixed-timber violet.
    expect(EASEMENT_STYLES.conservation.color.toLowerCase()).not.toBe(
      STAND_TYPE_COLORS.mixed.toLowerCase()
    );
  });

  it("falls back to the other style for unknown types", () => {
    expect(easementStyle("nope")).toBe(EASEMENT_STYLES.other);
  });

  it("legend lists only categories present, in catalog order", () => {
    expect(categoriesPresent([])).toEqual([]);
    expect(
      categoriesPresent([
        { easement_type: "flowage" },
        { easement_type: "powerline" },
        { easement_type: "drainage" },
      ])
    ).toEqual(["utility", "water"]);
  });
});

describe("migration of existing easements (0019)", () => {
  it("keeps powerline and pipeline rows as their type, burdens by default", () => {
    for (const t of ["powerline", "pipeline", "other"]) {
      const row = migrateLegacyEasementRow({
        id: "x",
        easement_type: t,
        name: "Line",
        acres: 2.3,
        boundary_geojson: null,
      });
      expect(row.easement_type).toBe(t);
      expect(row.relationship).toBe("burdens_this_property");
      expect(row.expiration_date).toBeNull();
      expect(row.width_ft).toBeNull();
      expect(row.elevation_ft).toBeNull();
      expect(row.program).toBeNull();
      expect(row.restrictions).toBeNull();
      expect(row.geom_geojson).toBeNull();
      expect(row.acres).toBe(2.3);
    }
  });

  it("an unknown legacy type lands on other rather than failing", () => {
    expect(migrateLegacyEasementRow({ easement_type: "weird" }).easement_type).toBe("other");
  });
});
