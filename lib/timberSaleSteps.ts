// TIMBER SALE STEPS (migration 0048): the sale as a guided path from
// planning to after the harvest. Pure and unit-tested; the sale page
// renders it. The checklist items and the advice follow Alabama
// Extension FOR-2101 "How Timber Is Sold", the Alabama Forestry
// Commission's timber sale contract considerations, and the ACES BMP
// guidelines (docs/research/2026-11-09/research-timber.md, M5).

export type SaleStage =
  | "planning"
  | "cruise"
  | "marketing"
  | "contract"
  | "harvesting"
  | "closeout"
  | "complete";

export const STAGE_ORDER: SaleStage[] = [
  "planning",
  "cruise",
  "marketing",
  "contract",
  "harvesting",
  "closeout",
  "complete",
];

export const STAGES: Record<SaleStage, { label: string; goal: string }> = {
  planning: {
    label: "Planning",
    goal: "Decide why to sell (a thinning that is due, a final harvest, salvage) and hire a consulting forester. Sellers who use one net more, even after the fee.",
  },
  cruise: {
    label: "Cruise",
    goal: "The forester measures the timber and estimates its value, which sets your minimum bid. Lines and streamside zones get marked now.",
  },
  marketing: {
    label: "Bids",
    goal: "The forester sends a notice of sale to buyers and opens sealed bids on a set date. Sealed bids usually bring the best price.",
  },
  contract: {
    label: "Contract",
    goal: "Sign a written contract with the winning buyer. Go through the clauses below with your forester or attorney.",
  },
  harvesting: {
    label: "Harvest",
    goal: "Logging is under way. Inspect during the cut, match settlements to scale tickets, and watch the cut-out deadline.",
  },
  closeout: {
    label: "Closeout",
    goal: "Walk the tract when logging ends: roads, skid trails, stream crossings, gates. Then return the deposit and reconcile the final settlement.",
  },
  complete: {
    label: "Done",
    goal: "Record the depletion on the timber basis page, keep the 1099-S, and plan what comes next (replanting after a clearcut, a burn after a thinning).",
  },
};

export interface ChecklistItem {
  key: string;
  stage: SaleStage;
  label: string;
  help?: string;
}

export const CHECKLIST: ChecklistItem[] = [
  { key: "goal_set", stage: "planning", label: "Reason for the sale decided (thinning, final harvest, salvage)" },
  { key: "forester_hired", stage: "planning", label: "Consulting forester hired, fee agreed in writing" },
  { key: "title_checked", stage: "planning", label: "Ownership and boundaries confirmed (deed, survey)" },

  { key: "cruise_done", stage: "cruise", label: "Timber cruised; volume and value estimate in hand" },
  { key: "lines_marked", stage: "cruise", label: "Property lines and sale boundary marked" },
  { key: "smz_marked", stage: "cruise", label: "Streamside zones marked (35 feet or more each side)", help: "Alabama BMPs. Mark before the bids so buyers price it in." },
  { key: "min_bid_set", stage: "cruise", label: "Minimum acceptable bid set" },

  { key: "notice_sent", stage: "marketing", label: "Notice of sale sent to buyers with a map and terms" },
  { key: "bid_date_set", stage: "marketing", label: "Sealed bid opening date set" },
  { key: "bids_compared", stage: "marketing", label: "Bids compared with the cruise value" },

  { key: "c_payment", stage: "contract", label: "Payment terms (lump sum at signing, or per-ton rates and settlement schedule)" },
  { key: "c_deadline", stage: "contract", label: "Cut-and-removal deadline" },
  { key: "c_deposit", stage: "contract", label: "Performance deposit and when it comes back" },
  { key: "c_bmp", stage: "contract", label: "Buyer follows Alabama BMPs, streamside zones left uncut" },
  { key: "c_closeout", stage: "contract", label: "Roads, skid trails, ditches, and stream crossings restored at the end" },
  { key: "c_damage", stage: "contract", label: "Damage to residual trees, fences, gates, and buildings repaired or paid" },
  { key: "c_insurance", stage: "contract", label: "Logger's liability and workers' comp insurance certificates" },
  { key: "c_volume", stage: "contract", label: "Buyer responsible for its own volume estimate" },
  { key: "c_access", stage: "contract", label: "Access routes, gates, and decks agreed" },

  { key: "h_inspected", stage: "harvesting", label: "Harvest inspected during the cut" },
  { key: "h_tickets", stage: "harvesting", label: "Settlements matched to scale tickets" },

  { key: "x_bmp", stage: "closeout", label: "BMP check passed: no erosion, crossings restored" },
  { key: "x_roads", stage: "closeout", label: "Roads, decks, and gates restored" },
  { key: "x_deposit", stage: "closeout", label: "Performance deposit returned" },
  { key: "x_final", stage: "closeout", label: "Final settlement reconciled" },

  { key: "d_1099s", stage: "complete", label: "1099-S received from the buyer (it usually arrives in February)" },
  { key: "d_depletion", stage: "complete", label: "Depletion recorded on the timber basis page" },
  { key: "d_next", stage: "complete", label: "Next step scheduled (replant, burn, or inspection)" },
];

export type CheckValue = "yes" | "no" | "na";

export function stageItems(stage: SaleStage): ChecklistItem[] {
  return CHECKLIST.filter((i) => i.stage === stage);
}

export function stageProgress(
  stage: SaleStage,
  checklist: Record<string, string> | null | undefined
): { done: number; total: number } {
  const items = stageItems(stage);
  const done = items.filter((i) => {
    const v = checklist?.[i.key];
    return v === "yes" || v === "na";
  }).length;
  return { done, total: items.length };
}

export interface SaleForSteps {
  stage: string | null;
  status: string; // active | completed | expired
  contract_date: string | null;
  harvest_start?: string | null;
  closeout_date?: string | null;
}

// A sale entered before the steps existed has no stage: read it from
// what is known. A completed sale is done; one with a contract is at
// harvest (or contract if logging has not started); else planning.
export function effectiveStage(sale: SaleForSteps, hasSettlements: boolean): SaleStage {
  if (sale.stage && STAGE_ORDER.includes(sale.stage as SaleStage)) return sale.stage as SaleStage;
  if (sale.status === "completed") return "complete";
  if (sale.closeout_date) return "closeout";
  if (sale.harvest_start || hasSettlements) return "harvesting";
  if (sale.contract_date) return "contract";
  return "planning";
}

export interface Bid {
  bidder: string;
  amount: number;
  is_winner?: boolean;
}

export interface BidAnalysis {
  high: Bid | null;
  low: Bid | null;
  count: number;
  spreadPct: number | null; // (high - low) / low
  meetsMin: boolean | null;
  winner: Bid | null;
}

// Wide spreads between sealed bids are normal; the point of showing it
// is that one buyer's number is not "the price".
export function analyzeBids(bids: Bid[], minBid: number | null | undefined): BidAnalysis {
  const sorted = [...bids].filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount);
  const high = sorted[0] ?? null;
  const low = sorted[sorted.length - 1] ?? null;
  return {
    high,
    low,
    count: sorted.length,
    spreadPct: high && low && low.amount > 0 && sorted.length > 1 ? (high.amount - low.amount) / low.amount : null,
    meetsMin: high && minBid != null ? high.amount >= minBid : null,
    winner: bids.find((b) => b.is_winner) ?? null,
  };
}

// The forester's fee as dollars, from a percent of the sale.
export function foresterFee(pct: number | null | undefined, saleTotal: number): number | null {
  if (pct == null || !(saleTotal > 0)) return null;
  return Math.round(saleTotal * pct) / 100;
}

// What comes after: a clearcut needs replanting (Alabama has no legal
// requirement, but the replanting deduction and cost-share favor doing
// it within a year or two); a thinning sets up a burn.
export function afterHarvestSuggestion(
  harvestType: string | null | undefined
): { activity: "planting" | "prescribed_burn"; text: string } | null {
  if (harvestType === "clearcut" || harvestType === "salvage") {
    return {
      activity: "planting",
      text: "Plan site prep and replanting within a year or two. Record the costs: they count toward the replanting deduction.",
    };
  }
  if (harvestType === "first_thinning" || harvestType === "second_thinning") {
    return {
      activity: "prescribed_burn",
      text: "A prescribed burn two or three years after a thinning keeps the understory open and lowers wildfire and beetle risk.",
    };
  }
  return null;
}
