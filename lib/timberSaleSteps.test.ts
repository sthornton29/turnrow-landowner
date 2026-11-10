import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKLIST,
  STAGE_ORDER,
  afterHarvestSuggestion,
  analyzeBids,
  effectiveStage,
  foresterFee,
  stageProgress,
} from "./timberSaleSteps";

const migration = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0048_timber_sale_workflow.sql"),
  "utf8"
);

describe("stages", () => {
  it("match the migration's check constraint", () => {
    const m = migration.match(/stage in\s*\(([^)]*)\)/);
    const sql = m![1].match(/'([a-z_]+)'/g)!.map((s) => s.replace(/'/g, ""));
    expect(sql).toEqual(STAGE_ORDER);
  });

  it("every stage has checklist items and keys are unique", () => {
    for (const s of STAGE_ORDER) expect(CHECKLIST.some((i) => i.stage === s)).toBe(true);
    expect(new Set(CHECKLIST.map((i) => i.key)).size).toBe(CHECKLIST.length);
  });

  it("reads a stage for sales entered before the steps", () => {
    const base = { stage: null, status: "active", contract_date: null };
    expect(effectiveStage(base, false)).toBe("planning");
    expect(effectiveStage({ ...base, contract_date: "2024-11-01" }, false)).toBe("contract");
    expect(effectiveStage({ ...base, contract_date: "2024-11-01" }, true)).toBe("harvesting");
    expect(effectiveStage({ ...base, status: "completed" }, true)).toBe("complete");
    expect(effectiveStage({ ...base, stage: "marketing" }, true)).toBe("marketing");
  });

  it("counts yes and not-applicable as done", () => {
    expect(stageProgress("closeout", { x_bmp: "yes", x_roads: "na", x_deposit: "no" })).toEqual({ done: 2, total: 4 });
  });
});

describe("bids", () => {
  it("finds the high bid, spread, and minimum", () => {
    const a = analyzeBids(
      [
        { bidder: "Tidwell", amount: 61818 },
        { bidder: "B", amount: 48000 },
        { bidder: "C", amount: 55000, is_winner: false },
      ],
      55000
    );
    expect(a.high?.bidder).toBe("Tidwell");
    expect(a.count).toBe(3);
    expect(a.spreadPct).toBeCloseTo(0.2879, 3);
    expect(a.meetsMin).toBe(true);
    expect(a.winner).toBeNull();
  });

  it("handles one bid and no minimum", () => {
    const a = analyzeBids([{ bidder: "Only", amount: 1000, is_winner: true }], null);
    expect(a.spreadPct).toBeNull();
    expect(a.meetsMin).toBeNull();
    expect(a.winner?.bidder).toBe("Only");
  });
});

describe("fees and next steps", () => {
  it("figures a forester's percent fee", () => {
    expect(foresterFee(8, 61818.28)).toBe(4945.46);
    expect(foresterFee(null, 1000)).toBeNull();
  });

  it("suggests replanting after a clearcut and a burn after a thinning", () => {
    expect(afterHarvestSuggestion("clearcut")?.activity).toBe("planting");
    expect(afterHarvestSuggestion("first_thinning")?.activity).toBe("prescribed_burn");
    expect(afterHarvestSuggestion("select_cut")).toBeNull();
  });
});
