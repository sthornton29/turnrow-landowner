// STAND ACTIVITIES: the dated history of what was done on a timber
// stand, and what it cost (migration 0045). This module is the single
// source for activity types, their plain-language buttons, the
// type-specific detail fields kept in stand_activities.details (the
// lib/assetTypes.ts pattern: validated jsonb), and the cost tax
// categories with the one plain question each answers.
//
// Tax categories are a SUGGESTION for the accountant, never advice:
//   reforestation       -> Sec 194 replanting deduction / amortization
//   operating_expense   -> upkeep of the woods
//   selling_expense     -> reduces the taxable gain on a timber sale
//   capital_improvement -> lasting improvements (roads, culverts)
//   not_sure            -> left for the accountant

export type ActivityType =
  | "site_prep"
  | "planting"
  | "herbicide"
  | "precommercial_thin"
  | "thinning"
  | "harvest"
  | "prescribed_burn"
  | "fertilization"
  | "firebreak"
  | "road_work"
  | "boundary_marking"
  | "inspection"
  | "damage"
  | "cruise"
  | "other";

export type ActivityStatus = "planned" | "done" | "skipped";

export type TaxCategory =
  | "reforestation"
  | "operating_expense"
  | "selling_expense"
  | "capital_improvement"
  | "not_sure";

export interface DetailField {
  key: string;
  label: string;
  input: "text" | "number" | "select";
  options?: Record<string, string>;
  placeholder?: string;
}

export interface ActivityTypeDef {
  label: string; // noun form for lists: "Prescribed burn"
  button: string; // the "What happened here?" button: "Burned"
  hint: string; // one plain line under the button
  defaultTax: TaxCategory;
  details: DetailField[];
  // Activities that change the stand's age clock / "last" facts.
  linksSale?: boolean;
}

const DAMAGE_CAUSES: Record<string, string> = {
  spb: "Southern pine beetle",
  ips: "Ips beetle",
  storm: "Storm or wind",
  ice: "Ice",
  fire: "Wildfire",
  flood: "Flood",
  theft: "Timber theft or trespass",
  other: "Other",
};

export const ACTIVITY_TYPES: Record<ActivityType, ActivityTypeDef> = {
  planting: {
    label: "Planting",
    button: "Planted",
    hint: "Seedlings went in",
    defaultTax: "reforestation",
    details: [
      { key: "species", label: "Species", input: "text", placeholder: "Loblolly pine" },
      { key: "seedlings_per_acre", label: "Seedlings per acre", input: "number" },
      {
        key: "genetics",
        label: "Seedling genetics",
        input: "select",
        options: {
          open_pollinated: "Open-pollinated (2nd or 3rd generation)",
          mass_control: "Mass control pollinated (MCP)",
          varietal: "Varietal (clonal)",
          unknown: "Not sure",
        },
      },
      { key: "seedling_source", label: "Nursery or seedling source", input: "text" },
      {
        key: "method",
        label: "Planting method",
        input: "select",
        options: { hand: "Hand planted", machine: "Machine planted" },
      },
    ],
  },
  site_prep: {
    label: "Site preparation",
    button: "Site prep",
    hint: "Getting ground ready to plant",
    defaultTax: "reforestation",
    details: [
      {
        key: "method",
        label: "Method",
        input: "select",
        options: {
          chemical: "Chemical (herbicide)",
          mechanical: "Mechanical (shear, rake, chop)",
          burn: "Site prep burn",
          subsoil: "Subsoiling or ripping",
          bedding: "Bedding",
          combination: "Combination",
        },
      },
    ],
  },
  herbicide: {
    label: "Herbicide",
    button: "Sprayed",
    hint: "Weed control or release spray",
    defaultTax: "operating_expense", // reforestation when the stand is young (taxCategoryFor)
    details: [
      { key: "product", label: "Product", input: "text", placeholder: "Arsenal + Oust" },
      { key: "rate", label: "Rate", input: "text", placeholder: "16 oz per acre" },
      {
        key: "target",
        label: "Purpose",
        input: "select",
        options: {
          herbaceous: "Herbaceous weed control (first year or two)",
          release: "Release from competing hardwoods",
          midstory: "Midstory control",
          invasive: "Invasive plants (cogongrass, privet)",
        },
      },
      {
        key: "application",
        label: "Applied by",
        input: "select",
        options: { aerial: "Helicopter", ground: "Ground (skidder or ATV)", backpack: "Backpack" },
      },
    ],
  },
  precommercial_thin: {
    label: "Precommercial thinning",
    button: "Thinned (no sale)",
    hint: "Thinned out trees too small to sell",
    defaultTax: "operating_expense",
    details: [],
  },
  thinning: {
    label: "Thinning",
    button: "Thinned",
    hint: "A thinning sale",
    defaultTax: "selling_expense",
    linksSale: true,
    details: [
      {
        key: "thin_type",
        label: "Kind of thinning",
        input: "select",
        options: {
          fifth_row: "Fifth row plus select",
          third_row: "Third row plus select",
          row: "Row thinning only",
          select: "Select (from below)",
        },
      },
      { key: "residual_basal_area", label: "Basal area left (sq ft per acre)", input: "number" },
      { key: "buyer", label: "Buyer or logger", input: "text" },
    ],
  },
  harvest: {
    label: "Harvest",
    button: "Harvested",
    hint: "Clearcut, select cut, or salvage",
    defaultTax: "selling_expense",
    linksSale: true,
    details: [
      {
        key: "harvest_type",
        label: "Kind of harvest",
        input: "select",
        options: {
          clearcut: "Clearcut (final harvest)",
          select_cut: "Select cut",
          salvage: "Salvage (storm or beetles)",
          seed_tree: "Seed tree or shelterwood",
        },
      },
      { key: "buyer", label: "Buyer or logger", input: "text" },
    ],
  },
  prescribed_burn: {
    label: "Prescribed burn",
    button: "Burned",
    hint: "A planned, permitted burn",
    defaultTax: "operating_expense",
    details: [
      {
        key: "season",
        label: "Season",
        input: "select",
        options: { dormant: "Dormant season (winter)", growing: "Growing season (spring or summer)" },
      },
      { key: "burn_manager", label: "Certified burn manager", input: "text" },
      { key: "permit_number", label: "AFC burn permit number", input: "text" },
    ],
  },
  fertilization: {
    label: "Fertilization",
    button: "Fertilized",
    hint: "Usually after a thinning, on a forester's advice",
    defaultTax: "operating_expense",
    details: [
      { key: "product", label: "Product", input: "text", placeholder: "DAP + urea" },
      { key: "rate", label: "Rate", input: "text", placeholder: "200 lb N per acre" },
    ],
  },
  firebreak: {
    label: "Firebreak work",
    button: "Firebreaks",
    hint: "Plowed or disked firebreaks",
    defaultTax: "operating_expense",
    details: [],
  },
  road_work: {
    label: "Road or culvert work",
    button: "Road work",
    hint: "Forest roads, culverts, gates",
    defaultTax: "capital_improvement",
    details: [],
  },
  boundary_marking: {
    label: "Boundary marking",
    button: "Marked lines",
    hint: "Painted or flagged property lines",
    defaultTax: "operating_expense",
    details: [],
  },
  inspection: {
    label: "Inspection",
    button: "Walked it",
    hint: "Checked the stand, looked for problems",
    defaultTax: "operating_expense",
    details: [{ key: "findings", label: "What you saw", input: "text" }],
  },
  damage: {
    label: "Damage",
    button: "Storm or bugs",
    hint: "Beetles, storm, fire, theft",
    defaultTax: "not_sure",
    details: [
      { key: "cause", label: "Cause", input: "select", options: DAMAGE_CAUSES },
      { key: "acres_affected", label: "Acres affected", input: "number" },
      {
        key: "severity",
        label: "How bad",
        input: "select",
        options: { light: "A few trees", moderate: "Spots", severe: "Large area lost" },
      },
    ],
  },
  cruise: {
    label: "Timber cruise",
    button: "Cruised",
    hint: "A forester measured the timber",
    defaultTax: "operating_expense",
    details: [
      { key: "forester", label: "Forester", input: "text" },
      { key: "estimated_value", label: "Estimated timber value ($)", input: "number" },
      { key: "trees_per_acre", label: "Trees per acre", input: "number" },
      { key: "basal_area", label: "Basal area (sq ft per acre)", input: "number" },
    ],
  },
  other: {
    label: "Other work",
    button: "Something else",
    hint: "Anything not listed",
    defaultTax: "not_sure",
    details: [],
  },
};

// The order of the "What happened here?" buttons: the common things first.
export const ACTIVITY_BUTTON_ORDER: ActivityType[] = [
  "planting",
  "herbicide",
  "prescribed_burn",
  "thinning",
  "harvest",
  "inspection",
  "damage",
  "site_prep",
  "fertilization",
  "precommercial_thin",
  "cruise",
  "firebreak",
  "road_work",
  "boundary_marking",
  "other",
];

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  done: "Done",
  planned: "Planned",
  skipped: "Not needed",
};

// Each category answers ONE plain question; the select shows the
// question, the record keeps the category.
export const TAX_CATEGORIES: Record<
  TaxCategory,
  { label: string; question: string; short: string }
> = {
  reforestation: {
    label: "Replanting cost (Section 194)",
    question: "Getting new trees growing (site prep, seedlings, planting, early spraying)",
    short: "Replanting",
  },
  operating_expense: {
    label: "Upkeep expense",
    question: "Upkeep of the woods (burning, firebreaks, spraying older trees, advice)",
    short: "Upkeep",
  },
  selling_expense: {
    label: "Selling expense",
    question: "Selling timber (forester's sale fee, a cruise for the sale, legal)",
    short: "Selling",
  },
  capital_improvement: {
    label: "Lasting improvement",
    question: "Something that lasts (a road, culvert, bridge, gate)",
    short: "Improvement",
  },
  not_sure: {
    label: "Not sure",
    question: "Not sure: let the accountant decide",
    short: "Not sure",
  },
};

export const TAX_NOTE = "For your accountant. Confirm with them before filing.";

// A young stand's spray is establishment (reforestation); an older
// stand's is upkeep. Age measured from the planting year.
export const ESTABLISHMENT_YEARS = 3;

export function taxCategoryFor(
  type: ActivityType,
  standYearEstablished: number | null | undefined,
  activityYear: number
): TaxCategory {
  if (
    type === "herbicide" &&
    standYearEstablished != null &&
    activityYear - standYearEstablished <= ESTABLISHMENT_YEARS &&
    activityYear >= standYearEstablished
  ) {
    return "reforestation";
  }
  return ACTIVITY_TYPES[type].defaultTax;
}

export function isActivityType(v: unknown): v is ActivityType {
  return typeof v === "string" && v in ACTIVITY_TYPES;
}

// Keep only known detail keys for the type; numbers parsed, blanks
// dropped, select values checked against their options. The DB stores
// whatever this returns.
export function cleanDetails(
  type: ActivityType,
  raw: Record<string, unknown>
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of ACTIVITY_TYPES[type].details) {
    const v = raw[f.key];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    if (f.input === "number") {
      const n = Number(s.replace(/,/g, ""));
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (f.input === "select") {
      if (f.options && s in f.options) out[f.key] = s;
    } else {
      out[f.key] = s.slice(0, 500);
    }
  }
  return out;
}

// One line describing an activity's details for lists: "Loblolly pine,
// 600 per acre, MCP".
export function detailSummary(
  type: ActivityType,
  details: Record<string, unknown> | null | undefined
): string {
  if (!details) return "";
  const parts: string[] = [];
  for (const f of ACTIVITY_TYPES[type].details) {
    const v = details[f.key];
    if (v === null || v === undefined || v === "") continue;
    if (f.input === "select") {
      const label = f.options?.[String(v)];
      if (label) parts.push(label);
    } else if (f.key === "seedlings_per_acre") {
      parts.push(`${Number(v).toLocaleString("en-US")} per acre`);
    } else if (f.key === "estimated_value") {
      parts.push(
        `value about $${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
      );
    } else if (f.input === "number") {
      parts.push(`${f.label.toLowerCase()} ${Number(v).toLocaleString("en-US")}`);
    } else {
      parts.push(String(v));
    }
  }
  return parts.join(", ");
}

// Default title when the user leaves it blank: the type label, plus
// the species for a planting.
export function defaultTitle(
  type: ActivityType,
  details: Record<string, unknown> | null | undefined
): string {
  const def = ACTIVITY_TYPES[type];
  if (type === "planting" && details?.species) return `Planted ${details.species}`;
  if (type === "damage" && details?.cause) {
    const cause = DAMAGE_CAUSES[String(details.cause)];
    if (cause) return `${cause} damage`;
  }
  return def.label;
}

export interface ActivityLike {
  activity_type: string;
  status: string;
  activity_year: number;
}

// Computed "last" facts from the log, falling back to the legacy
// columns entered before the log existed. Harvests count as thinnings
// only when they are thinning-type; a final harvest resets the stand.
export function lastYearOf(
  activities: ActivityLike[],
  types: ActivityType[],
  legacy: number | null | undefined
): number | null {
  let best: number | null = legacy ?? null;
  for (const a of activities) {
    if (a.status !== "done") continue;
    if (!types.includes(a.activity_type as ActivityType)) continue;
    if (best === null || a.activity_year > best) best = a.activity_year;
  }
  return best;
}
