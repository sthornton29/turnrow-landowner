import { describe, expect, it } from "vitest";
import { planForStand, siteIndex25, siteClass, type PlanActivity, type PlanStand } from "./timberPlan";

const pine = (over: Partial<PlanStand> = {}): PlanStand => ({
  id: "s1",
  name: "Summerwood Pines",
  stand_type: "planted_pine",
  year_established: 2011,
  site_index: null,
  ...over,
});

const keys = (recs: ReturnType<typeof planForStand>) => recs.map((r) => r.key);

describe("site index", () => {
  it("converts base 50 to base 25 roughly and classes it", () => {
    expect(siteIndex25(90, 50)).toBe(65);
    expect(siteIndex25(70, 25)).toBe(70);
    expect(siteIndex25(null, 25)).toBeNull();
    expect(siteClass(80)).toBe("high");
    expect(siteClass(70)).toBe("medium");
    expect(siteClass(60)).toBe("low");
    expect(siteClass(null)).toBe("unknown");
  });
});

describe("planted pine template", () => {
  it("puts a 2011 planting in its first thinning window in 2026", () => {
    const recs = planForStand(pine(), [], 2026);
    const first = recs.find((r) => r.key === "first_thin")!;
    expect(first.windowStart).toBe(2025);
    expect(first.windowEnd).toBe(2028);
    expect(first.status).toBe("due");
    expect(first.priority).toBe("high");
    // release spray long past: not shown
    expect(keys(recs)).not.toContain("release");
    // final harvest is far off
    expect(recs.find((r) => r.key === "final_harvest")!.status).toBe("later");
    // first in the list after sorting: the thinning (due/high) before the walk (due/low)
    expect(recs[0].key).toBe("first_thin");
  });

  it("uses site index for the window", () => {
    const high = planForStand(pine({ site_index: 80 }), [], 2026).find((r) => r.key === "first_thin")!;
    expect([high.windowStart, high.windowEnd]).toEqual([2024, 2026]);
    const low = planForStand(pine({ site_index: 60 }), [], 2026).find((r) => r.key === "first_thin")!;
    expect([low.windowStart, low.windowEnd]).toEqual([2027, 2029]);
    expect(low.status).toBe("upcoming");
  });

  it("asks for a release spray on a young stand until one is recorded", () => {
    const young = pine({ year_established: 2025 });
    expect(keys(planForStand(young, [], 2026))).toContain("release");
    const sprayed: PlanActivity[] = [{ activity_type: "herbicide", status: "done", activity_year: 2026 }];
    expect(keys(planForStand(young, sprayed, 2026))).not.toContain("release");
  });

  it("after a first thinning, schedules a burn and a second thinning", () => {
    const acts: PlanActivity[] = [{ activity_type: "thinning", status: "done", activity_year: 2025 }];
    const recs = planForStand(pine(), acts, 2026);
    expect(keys(recs)).not.toContain("first_thin");
    const burn = recs.find((r) => r.activityType === "prescribed_burn")!;
    expect(burn.key).toBe("burn:2027");
    expect(burn.status).toBe("upcoming");
    const second = recs.find((r) => r.key === "second_thin")!;
    expect(second.windowStart).toBe(2033); // max(2025+6, 2011+22)
  });

  it("honors the legacy last thinning year and keeps a burn cycle going", () => {
    const recs = planForStand(pine({ last_thinning_year: 2024, last_burn_year: 2025 }), [], 2026);
    expect(keys(recs)).not.toContain("first_thin");
    const burn = recs.find((r) => r.activityType === "prescribed_burn")!;
    expect([burn.windowStart, burn.windowEnd]).toEqual([2028, 2030]);
  });

  it("burns more often for wildlife", () => {
    const recs = planForStand(
      pine({ last_thinning_year: 2024, last_burn_year: 2025, management_goal: "wildlife" }),
      [],
      2026
    );
    const burn = recs.find((r) => r.activityType === "prescribed_burn")!;
    expect([burn.windowStart, burn.windowEnd]).toEqual([2027, 2028]);
  });

  it("drops answered recommendations and marks scheduled ones", () => {
    const skipped: PlanActivity[] = [
      { activity_type: "thinning", status: "skipped", activity_year: 2026, plan_key: "first_thin" },
    ];
    expect(keys(planForStand(pine(), skipped, 2026))).not.toContain("first_thin");
    const planned: PlanActivity[] = [
      { activity_type: "thinning", status: "planned", activity_year: 2027, plan_key: "first_thin" },
    ];
    const rec = planForStand(pine(), planned, 2026).find((r) => r.key === "first_thin")!;
    expect(rec.status).toBe("scheduled");
    expect(rec.scheduledYear).toBe(2027);
  });

  it("asks only to replant after a clearcut", () => {
    const acts: PlanActivity[] = [
      { activity_type: "harvest", status: "done", activity_year: 2025, details: { harvest_type: "clearcut" } },
    ];
    const recs = planForStand(pine({ year_established: 1995 }), acts, 2026);
    expect(keys(recs)).toEqual(["replant:2025"]);
    expect(recs[0].status).toBe("due");
  });

  it("does not ask a hardwood stand to be replanted after a harvest", () => {
    const hw: PlanStand = { id: "h", name: "Betts Hardwoods", stand_type: "hardwood", year_established: null, site_index: null };
    const acts: PlanActivity[] = [
      { activity_type: "harvest", status: "done", activity_year: 2006, details: { harvest_type: "clearcut" } },
    ];
    expect(planForStand(hw, acts, 2026).some((r) => r.key.startsWith("replant"))).toBe(false);
  });

  it("restarts the clock when the stand is replanted", () => {
    const acts: PlanActivity[] = [
      { activity_type: "harvest", status: "done", activity_year: 2021, details: { harvest_type: "clearcut" } },
      { activity_type: "planting", status: "done", activity_year: 2022 },
    ];
    const recs = planForStand(pine({ year_established: 1990 }), acts, 2023);
    expect(keys(recs)).toContain("release");
    expect(recs.find((r) => r.key === "first_thin")!.windowStart).toBe(2036);
  });

  it("a select cut does not count as a final harvest", () => {
    const acts: PlanActivity[] = [
      { activity_type: "harvest", status: "done", activity_year: 2025, details: { harvest_type: "select_cut" } },
    ];
    const recs = planForStand(pine(), acts, 2026);
    expect(keys(recs).some((k) => k.startsWith("replant"))).toBe(false);
    expect(keys(recs)).not.toContain("first_thin");
  });

  it("a harvest with no kind chosen still asks about replanting (thinning is its own type)", () => {
    for (const acts of [
      [{ activity_type: "harvest", status: "done", activity_year: 2025 }],
      [{ activity_type: "harvest", status: "done", activity_year: 2025, details: {} }],
    ] as PlanActivity[][]) {
      const recs = planForStand(pine(), acts, 2026);
      expect(keys(recs)).toContain("replant:2025");
      expect(keys(recs)).not.toContain("first_thin");
    }
  });

  it("keeps the yearly walk after a replant is answered not needed", () => {
    const acts: PlanActivity[] = [
      { activity_type: "harvest", status: "done", activity_year: 2025, details: { harvest_type: "clearcut" } },
      { activity_type: "planting", status: "skipped", activity_year: 2026, plan_key: "replant:2025" },
    ];
    const stand = pine({ year_established: 1995 });
    expect(keys(planForStand(stand, acts, 2026))).toEqual(["inspect:2026"]);
    // ...and the walk comes back each year, never an empty plan.
    expect(keys(planForStand(stand, acts, 2027))).toEqual(["inspect:2027"]);
  });

  it("asks for the planting year when it is missing", () => {
    const recs = planForStand(pine({ year_established: null }), [], 2026);
    expect(recs.find((r) => r.key === "needs_year")?.setupOnly).toBe(true);
  });
});

describe("walk the stand", () => {
  it("is due each year until an inspection is recorded that year", () => {
    expect(keys(planForStand(pine(), [], 2026))).toContain("inspect:2026");
    const walked: PlanActivity[] = [{ activity_type: "inspection", status: "done", activity_year: 2026 }];
    expect(keys(planForStand(pine(), walked, 2026))).not.toContain("inspect:2026");
    const lastYear: PlanActivity[] = [{ activity_type: "inspection", status: "done", activity_year: 2025 }];
    expect(keys(planForStand(pine(), lastYear, 2026))).toContain("inspect:2026");
  });
});

describe("hardwood and natural pine", () => {
  it("suggests a forester walk-through, then every 10 years after a cruise", () => {
    const hw: PlanStand = { id: "h", name: "Green Hardwoods", stand_type: "hardwood", year_established: null, site_index: null };
    const recs = planForStand(hw, [], 2026);
    expect(keys(recs)).toEqual(expect.arrayContaining(["forester:2026", "inspect:2026"]));
    const cruised: PlanActivity[] = [{ activity_type: "cruise", status: "done", activity_year: 2020 }];
    const later = planForStand(hw, cruised, 2026).find((r) => r.activityType === "cruise")!;
    expect(later.key).toBe("forester:2030");
    expect(later.status).toBe("later");
  });

  it("keeps a natural pine burn cycle only when burns are on record", () => {
    const np: PlanStand = { id: "n", name: "N", stand_type: "natural_pine", year_established: null, site_index: null };
    expect(planForStand(np, [], 2026).some((r) => r.activityType === "prescribed_burn")).toBe(false);
    const burned: PlanActivity[] = [{ activity_type: "prescribed_burn", status: "done", activity_year: 2022 }];
    const burn = planForStand(np, burned, 2026).find((r) => r.activityType === "prescribed_burn")!;
    expect([burn.windowStart, burn.windowEnd, burn.status]).toEqual([2025, 2027, "due"]);
  });
});
