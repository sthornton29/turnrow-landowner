// TIMBER PLAN: the "what should happen next" schedule for a stand,
// generated from templates by stand type, planting year, and site
// index, then reconciled against the stand's activity log
// (lib/standActivities.ts, migration 0045). Pure and unit-tested; the
// app only SUGGESTS: the owner marks a recommendation done (recording
// an activity), schedules it (a planned activity), or answers "not
// needed" (a skipped activity). Each answer carries the
// recommendation's plan_key, which is how it stops showing.
//
// Template sources (see docs/research/2026-11-09/research-timber.md):
//   * Loblolly first thinning about age 17 / 14 / 13 for site index
//     60 / 70 / 80 (base age 25), second thinning about 30 / 22 / 21
//     (Mississippi State Extension, "Protect your pine plantation
//     investment: thinning").
//   * Herbicide release in years 1 to 2; burns every 3 to 5 years after
//     the first thinning; final harvest about 28 to 35 (ACES, NC Forest
//     Service FM08).
//   * Walk the stand every year for fading crowns (southern pine
//     beetle, ACES FOR-2200).
// These are starting points for a conversation with a forester, and
// every screen that shows them says so.

import type { ActivityType } from "./standActivities";

export interface PlanStand {
  id: string;
  name: string;
  stand_type: string | null;
  year_established: number | null;
  site_index: number | null;
  site_index_base_age?: number | null;
  last_thinning_year?: number | null;
  last_burn_year?: number | null;
  management_goal?: string | null;
}

export interface PlanActivity {
  activity_type: string;
  status: string; // done | planned | skipped
  activity_year: number;
  plan_key?: string | null;
  details?: Record<string, unknown> | null;
}

export type RecStatus = "overdue" | "due" | "upcoming" | "later" | "scheduled";
export type RecPriority = "high" | "normal" | "low";

export interface Recommendation {
  key: string; // plan_key: stable per stand
  standId: string;
  activityType: ActivityType;
  title: string;
  reason: string; // plain language
  windowStart: number;
  windowEnd: number;
  status: RecStatus;
  priority: RecPriority;
  scheduledYear?: number; // when status is scheduled
  setupOnly?: boolean; // a prompt to fill in stand facts, not field work
}

const PINE_TYPES = new Set(["planted_pine", "natural_pine"]);

// Site index on base age 25. Base-50 values are converted with a rough
// loblolly ratio (SI25 is about 0.72 of SI50); good enough to pick a
// thinning window, which is all this is used for.
export function siteIndex25(
  siteIndex: number | null | undefined,
  baseAge: number | null | undefined
): number | null {
  if (siteIndex == null || !Number.isFinite(siteIndex) || siteIndex <= 0) return null;
  if (baseAge === 50) return Math.round(siteIndex * 0.72);
  return siteIndex;
}

type SiteClass = "high" | "medium" | "low" | "unknown";

export function siteClass(si25: number | null): SiteClass {
  if (si25 == null) return "unknown";
  if (si25 >= 75) return "high";
  if (si25 >= 65) return "medium";
  return "low";
}

// Ages (years after planting) for the planted pine template.
export const PINE_AGES: Record<
  SiteClass,
  { firstThin: [number, number]; secondThin: number; finalHarvest: [number, number] }
> = {
  high: { firstThin: [13, 15], secondThin: 21, finalHarvest: [28, 32] },
  medium: { firstThin: [14, 16], secondThin: 22, finalHarvest: [30, 35] },
  low: { firstThin: [16, 18], secondThin: 28, finalHarvest: [33, 38] },
  unknown: { firstThin: [14, 17], secondThin: 22, finalHarvest: [30, 35] },
};

const FORESTER_REVIEW_YEARS = 10;

function statusFor(start: number, end: number, now: number): RecStatus {
  if (now > end) return "overdue";
  if (now >= start) return "due";
  if (start - now <= 3) return "upcoming";
  return "later";
}

function done(a: PlanActivity): boolean {
  return a.status === "done";
}

function isThinning(a: PlanActivity): boolean {
  if (a.activity_type === "thinning") return true;
  return a.activity_type === "harvest" && a.details?.harvest_type === "select_cut";
}

function isFinalHarvest(a: PlanActivity): boolean {
  return (
    a.activity_type === "harvest" &&
    (a.details?.harvest_type === undefined ||
      a.details?.harvest_type === null ||
      a.details?.harvest_type === "clearcut" ||
      a.details?.harvest_type === "salvage")
  );
}

// Generate the stand's recommendations for the year `now`. Answered
// recommendations (an activity with the same plan_key, done or skipped)
// are dropped; a planned activity with the key shows as "scheduled".
export function planForStand(
  stand: PlanStand,
  activities: PlanActivity[],
  now: number
): Recommendation[] {
  const recs: Recommendation[] = [];
  const add = (r: Omit<Recommendation, "standId" | "status"> & { status?: RecStatus }) => {
    recs.push({
      ...r,
      standId: stand.id,
      status: r.status ?? statusFor(r.windowStart, r.windowEnd, now),
    });
  };
  const doneActs = activities.filter(done);
  const type = stand.stand_type ?? "other";
  const wildlife = stand.management_goal === "wildlife";

  // Effective establishment: a later recorded planting restarts the
  // clock (replanted after a harvest).
  let est = stand.year_established ?? null;
  for (const a of doneActs) {
    if (a.activity_type === "planting" && (est === null || a.activity_year > est)) {
      est = a.activity_year;
    }
  }

  // A final harvest after establishment of a PLANTED pine stand: the
  // only thing that matters next is getting trees back. Hardwood and
  // natural stands usually regrow on their own, so they keep their
  // normal template.
  const lastFinal = type !== "planted_pine" ? null : doneActs
    .filter(isFinalHarvest)
    .reduce<number | null>((m, a) => (m === null || a.activity_year > m ? a.activity_year : m), null);
  if (lastFinal !== null && (est === null || lastFinal > est)) {
    add({
      key: `replant:${lastFinal}`,
      activityType: "planting",
      title: "Replant",
      reason:
        "Harvested and not yet replanted. Plan site prep and planting within a year or two, and record the costs: they count toward the replanting deduction (Section 194).",
      windowStart: lastFinal,
      windowEnd: lastFinal + 2,
      priority: "high",
    });
    return applyAnswers(recs, activities);
  }

  // Every stand: walk it once a year.
  const inspectedThisYear = doneActs.some(
    (a) =>
      a.activity_year === now &&
      (a.activity_type === "inspection" || a.activity_type === "cruise" || a.activity_type === "damage")
  );
  if (!inspectedThisYear) {
    add({
      key: `inspect:${now}`,
      activityType: "inspection",
      title: "Walk the stand",
      reason: PINE_TYPES.has(type)
        ? "Once a year, walk the lines and look for fading or red crowns (pine beetles), storm damage, and trespass."
        : "Once a year, walk the lines and look for storm damage, trespass, and invasive plants.",
      windowStart: now,
      windowEnd: now,
      priority: "low",
    });
  }

  if (type === "planted_pine") {
    if (est === null) {
      add({
        key: "needs_year",
        activityType: "other",
        title: "Add the planting year",
        reason: "With the year it was planted, Turnrow can lay out thinnings, burns, and harvest timing.",
        windowStart: now,
        windowEnd: now,
        status: "due",
        priority: "normal",
        setupOnly: true,
      });
      return applyAnswers(recs, activities);
    }
    const sc = siteClass(siteIndex25(stand.site_index, stand.site_index_base_age));
    const ages = PINE_AGES[sc];
    const siNote =
      sc === "unknown"
        ? " Add the site index for a sharper window."
        : ` Based on site index ${stand.site_index}${stand.site_index_base_age === 50 ? " (base 50)" : ""}.`;

    // Release spray, only while it still matters.
    const sprayed = doneActs.some(
      (a) => a.activity_type === "herbicide" && a.activity_year >= est! && a.activity_year <= est! + 3
    );
    if (!sprayed && now <= est + 3) {
      add({
        key: "release",
        activityType: "herbicide",
        title: "Herbicide release",
        reason:
          "In the first year or two, controlling weeds and hardwood sprouts is the biggest boost to early growth. Costs count as replanting costs.",
        windowStart: est + 1,
        windowEnd: est + 2,
        priority: "normal",
      });
    }

    // Thinnings.
    const thins = doneActs
      .filter((a) => isThinning(a) && a.activity_year >= est! + 8)
      .map((a) => a.activity_year);
    if (stand.last_thinning_year != null && stand.last_thinning_year >= est + 8) {
      thins.push(stand.last_thinning_year);
    }
    thins.sort((a, b) => a - b);
    const firstThin = thins[0] ?? null;

    if (firstThin === null) {
      add({
        key: "first_thin",
        activityType: "thinning",
        title: "First thinning",
        reason: `Planted ${est}. A first thinning around age ${ages.firstThin[0]} to ${ages.firstThin[1]} grows bigger, more valuable trees and is the best defense against pine beetles. Have a forester cruise it first.${siNote}`,
        windowStart: est + ages.firstThin[0],
        windowEnd: est + ages.firstThin[1],
        priority: "high",
      });
    } else {
      const secondDone = thins.some((y) => y >= firstThin + 3);
      if (!secondDone) {
        const start = Math.max(firstThin + 6, est + ages.secondThin);
        add({
          key: "second_thin",
          activityType: "thinning",
          title: "Second thinning",
          reason: `First thinned ${firstThin}. A second thinning (or fertilizing, if your forester recommends it) usually comes 6 to 10 years later.`,
          windowStart: start,
          windowEnd: start + 3,
          priority: "normal",
        });
      }
      // Burns follow thinning.
      const lastBurn = lastBurnYear(stand, doneActs);
      const interval = wildlife ? [2, 3] : [3, 5];
      const base = lastBurn !== null && lastBurn >= firstThin ? lastBurn : firstThin;
      const start = lastBurn !== null && lastBurn >= firstThin ? base + interval[0] : base + 2;
      add({
        key: `burn:${start}`,
        activityType: "prescribed_burn",
        title: "Prescribed burn",
        reason: `${lastBurn !== null && lastBurn >= firstThin ? `Last burned ${lastBurn}.` : `Thinned ${firstThin}.`} Burning every ${interval[0]} to ${interval[1]} years after thinning keeps the understory open${wildlife ? " and feeds wildlife" : ""}, and cuts wildfire risk. Needs an AFC permit.`,
        windowStart: start,
        windowEnd: start + (interval[1] - interval[0]),
        priority: "normal",
      });
    }

    add({
      key: "final_harvest",
      activityType: "harvest",
      title: "Final harvest",
      reason: `Typical rotation for this site is age ${ages.finalHarvest[0]} to ${ages.finalHarvest[1]}. Your forester and the markets decide the real timing.`,
      windowStart: est + ages.finalHarvest[0],
      windowEnd: est + ages.finalHarvest[1],
      priority: "low",
    });
  } else if (type === "natural_pine") {
    foresterReview(doneActs, now, add, "Natural pine is thinned by a forester's eye, not a calendar. Have one walk it about every 10 years to mark a thinning or harvest.");
    const lastBurn = lastBurnYear(stand, doneActs);
    if (lastBurn !== null) {
      const interval = wildlife ? [2, 3] : [3, 5];
      const start = lastBurn + interval[0];
      add({
        key: `burn:${start}`,
        activityType: "prescribed_burn",
        title: "Prescribed burn",
        reason: `Last burned ${lastBurn}. Keeping a ${interval[0]} to ${interval[1]} year burn cycle holds back hardwood brush. Needs an AFC permit.`,
        windowStart: start,
        windowEnd: start + (interval[1] - interval[0]),
        priority: "normal",
      });
    }
  } else if (type === "hardwood" || type === "mixed") {
    foresterReview(
      doneActs,
      now,
      add,
      type === "hardwood"
        ? "Hardwoods are managed by selective cuts marked by a forester. A walk-through about every 10 years tells you what is ready and what to leave. Keep streamside zones (35 feet or more) uncut."
        : "Mixed pine and hardwood stands need a forester's eye to decide which way to manage them. A walk-through about every 10 years."
    );
  }

  return applyAnswers(recs, activities);
}

function lastBurnYear(stand: PlanStand, doneActs: PlanActivity[]): number | null {
  let best = stand.last_burn_year ?? null;
  for (const a of doneActs) {
    if (a.activity_type !== "prescribed_burn") continue;
    if (best === null || a.activity_year > best) best = a.activity_year;
  }
  return best;
}

function foresterReview(
  doneActs: PlanActivity[],
  now: number,
  add: (r: Omit<Recommendation, "standId" | "status"> & { status?: RecStatus }) => void,
  reason: string
) {
  const lastLook = doneActs
    .filter((a) => a.activity_type === "cruise" || isThinning(a) || a.activity_type === "harvest")
    .reduce<number | null>((m, a) => (m === null || a.activity_year > m ? a.activity_year : m), null);
  const start = lastLook === null ? now : lastLook + FORESTER_REVIEW_YEARS;
  add({
    key: `forester:${start}`,
    activityType: "cruise",
    title: "Forester walk-through",
    reason: lastLook === null ? `No cruise or harvest on record. ${reason}` : `Last cruise or cut ${lastLook}. ${reason}`,
    windowStart: start,
    windowEnd: start + 1,
    priority: "low",
  });
}

// Drop recommendations already answered (done or "not needed") and mark
// the scheduled ones.
function applyAnswers(recs: Recommendation[], activities: PlanActivity[]): Recommendation[] {
  const out: Recommendation[] = [];
  for (const r of recs) {
    const answers = activities.filter((a) => a.plan_key === r.key);
    if (answers.some((a) => a.status === "done" || a.status === "skipped")) continue;
    const planned = answers.find((a) => a.status === "planned");
    if (planned) {
      out.push({ ...r, status: "scheduled", scheduledYear: planned.activity_year });
    } else {
      out.push(r);
    }
  }
  return out.sort(compareRecs);
}

const STATUS_ORDER: Record<RecStatus, number> = {
  overdue: 0,
  due: 1,
  scheduled: 2,
  upcoming: 3,
  later: 4,
};
const PRIORITY_ORDER: Record<RecPriority, number> = { high: 0, normal: 1, low: 2 };

export function compareRecs(a: Recommendation, b: Recommendation): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    a.windowStart - b.windowStart
  );
}

export const REC_STATUS_LABELS: Record<RecStatus, string> = {
  overdue: "Past due",
  due: "Due now",
  scheduled: "Scheduled",
  upcoming: "Coming up",
  later: "Later",
};

export function windowText(r: Recommendation): string {
  if (r.status === "scheduled" && r.scheduledYear) return `Scheduled ${r.scheduledYear}`;
  return r.windowStart === r.windowEnd ? `${r.windowStart}` : `${r.windowStart} to ${r.windowEnd}`;
}

export const PLAN_NOTE =
  "Suggested from typical timing for this kind of stand. Your forester's advice comes first.";
