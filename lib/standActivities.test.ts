import { describe, expect, it } from "vitest";
import {
  ACTIVITY_BUTTON_ORDER,
  ACTIVITY_TYPES,
  cleanDetails,
  defaultTitle,
  detailSummary,
  lastYearOf,
  taxCategoryFor,
  type ActivityType,
} from "./standActivities";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0045_timber_records.sql"),
  "utf8"
);

describe("activity types", () => {
  it("match the migration's check constraint exactly", () => {
    const m = migration.match(/activity_type\s+text not null check \(activity_type in\s*\(([^)]*)\)\)/);
    expect(m).not.toBeNull();
    const sqlTypes = m![1].match(/'([a-z_]+)'/g)!.map((s) => s.replace(/'/g, "")).sort();
    expect(sqlTypes).toEqual(Object.keys(ACTIVITY_TYPES).sort());
  });

  it("every type has a button, and every button is a type", () => {
    expect([...ACTIVITY_BUTTON_ORDER].sort()).toEqual(Object.keys(ACTIVITY_TYPES).sort());
  });

  it("tax categories match the migration", () => {
    const m = migration.match(/tax_category\s+text not null default 'not_sure' check \(tax_category in\s*\(([^)]*)\)\)/);
    const sqlCats = m![1].match(/'([a-z_]+)'/g)!.map((s) => s.replace(/'/g, "")).sort();
    const used = new Set(Object.values(ACTIVITY_TYPES).map((d) => d.defaultTax));
    for (const c of used) expect(sqlCats).toContain(c);
  });

  // The tax category list calls "a cruise for the sale" a selling cost,
  // and a selling cost lowers a sale's gain only when the work it was
  // entered on is tied to that sale. A Cruised entry with no sale picker
  // left its selling cost out of the gain for good.
  it("lets a cruise be tied to a timber sale, like a thinning or a harvest", () => {
    const linkable = (Object.keys(ACTIVITY_TYPES) as ActivityType[]).filter((t) => ACTIVITY_TYPES[t].linksSale).sort();
    expect(linkable).toEqual(["cruise", "harvest", "thinning"]);
  });
});

describe("taxCategoryFor", () => {
  it("treats a spray on a young stand as replanting cost", () => {
    expect(taxCategoryFor("herbicide", 2025, 2026)).toBe("reforestation");
    expect(taxCategoryFor("herbicide", 2011, 2026)).toBe("operating_expense");
    expect(taxCategoryFor("herbicide", null, 2026)).toBe("operating_expense");
  });
  it("uses the type default otherwise", () => {
    expect(taxCategoryFor("planting", null, 2026)).toBe("reforestation");
    expect(taxCategoryFor("thinning", 2011, 2026)).toBe("selling_expense");
    expect(taxCategoryFor("road_work", 2011, 2026)).toBe("capital_improvement");
  });
});

describe("details", () => {
  it("keeps known keys, parses numbers, checks options, drops blanks", () => {
    const out = cleanDetails("planting", {
      species: " Loblolly pine ",
      seedlings_per_acre: "622",
      genetics: "bogus",
      method: "machine",
      extra: "x",
      seedling_source: "",
    });
    expect(out).toEqual({ species: "Loblolly pine", seedlings_per_acre: 622, method: "machine" });
  });

  it("summarizes for lists", () => {
    expect(detailSummary("planting", { species: "Loblolly pine", seedlings_per_acre: 622, genetics: "mass_control" })).toBe(
      "Loblolly pine, 622 per acre, Mass control pollinated (MCP)"
    );
    expect(detailSummary("cruise", { estimated_value: 163072 })).toBe("value about $163,072");
  });

  it("titles plantings and damage helpfully", () => {
    expect(defaultTitle("planting", { species: "Loblolly pine" })).toBe("Planted Loblolly pine");
    expect(defaultTitle("damage", { cause: "spb" })).toBe("Southern pine beetle damage");
    expect(defaultTitle("prescribed_burn", {})).toBe("Prescribed burn");
  });
});

describe("lastYearOf", () => {
  it("takes the later of the log and the legacy column, done only", () => {
    const acts = [
      { activity_type: "prescribed_burn", status: "done", activity_year: 2022 },
      { activity_type: "prescribed_burn", status: "planned", activity_year: 2027 },
    ];
    const t: ActivityType[] = ["prescribed_burn"];
    expect(lastYearOf(acts, t, 2019)).toBe(2022);
    expect(lastYearOf(acts, t, 2024)).toBe(2024);
    expect(lastYearOf([], t, null)).toBeNull();
  });
});
