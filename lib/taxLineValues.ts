// The values a property tax bill prints for one parcel beyond its tax and
// the single "appraised" number (migration 0050): market value, current
// use value, land and improvement value, assessment ratio, tax district,
// millage, timber acres. Read from the extraction (TAX_STATEMENT_TOOL
// line fields) by new uploads and by the Re-read bills review.

export interface LineValues {
  market_value: number | null;
  current_use_value: number | null;
  land_value: number | null;
  improvement_value: number | null;
  assessment_ratio: number | null; // percent
  tax_district: string | null;
  millage: number | null;
  timber_acres: number | null;
}

export const LINE_VALUE_KEYS: Array<keyof LineValues> = [
  "market_value",
  "current_use_value",
  "land_value",
  "improvement_value",
  "assessment_ratio",
  "tax_district",
  "millage",
  "timber_acres",
];

export const LINE_VALUE_LABELS: Record<keyof LineValues, string> = {
  market_value: "Market value",
  current_use_value: "Current use value",
  land_value: "Land value",
  improvement_value: "Buildings",
  assessment_ratio: "Ratio %",
  tax_district: "District",
  millage: "Mills",
  timber_acres: "Timber ac",
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function readLineValues(raw: Record<string, unknown>): LineValues {
  let ratio = num(raw.assessment_ratio);
  // A ratio printed as a fraction (0.10) becomes a percent.
  if (ratio !== null && ratio > 0 && ratio <= 1) ratio = Math.round(ratio * 1000) / 10;
  let mills = num(raw.millage);
  // A rate printed per dollar (0.030) becomes mills.
  if (mills !== null && mills > 0 && mills < 1) mills = Math.round(mills * 100000) / 100;
  const district = raw.tax_district === null || raw.tax_district === undefined ? null : String(raw.tax_district).trim() || null;
  return {
    market_value: num(raw.market_value),
    current_use_value: num(raw.current_use_value),
    land_value: num(raw.land_value),
    improvement_value: num(raw.improvement_value),
    assessment_ratio: ratio,
    tax_district: district,
    millage: mills,
    timber_acres: num(raw.timber_acres),
  };
}

export function hasAnyValue(v: LineValues): boolean {
  return LINE_VALUE_KEYS.some((k) => v[k] !== null);
}
