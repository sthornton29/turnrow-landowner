// COUNTY RECORD: one shape for the parcel attributes that county GIS
// services return (parcels.attributes and parcel_valuations.attributes,
// migration 0049). Field names differ by county: Lawrence and Colbert are
// KCS layers (TAV, TTV, CLandValue, CImpValue, TimberAcres, TaxDist,
// TotalTaxDue; Colbert adds HasCurrentUse and CurrentUseValue), Morgan uses
// AssdValue, TotalLandValue, TotalImpValue, TimberAcreage, AssessmentClass.
//
// Verified 2026-11-09 on the live records: in Lawrence and Colbert,
// TotalTaxDue = TAV x district mills + $0.10 x TimberAcres + a fire fee per
// building, to the penny. TTV (= CLandValue + CImpValue on current use
// land) is the CURRENT USE value when the parcel is enrolled, so
// TAV x 10 / acres is the taxable value per acre the current use test
// compares with the ADOR table.

export interface CountyRecord {
  year: number | null;
  assessed: number | null; // TAV / AssdValue
  taxableValue: number | null; // assessed / class ratio (the value the tax is figured on)
  landValue: number | null;
  // True on KCS layers (Lawrence, Colbert): CLandValue is the land value
  // the tax is figured on (the current use value when enrolled). Morgan's
  // TotalLandValue is market value, so its taxable land comes from the
  // assessed value instead.
  landValueIsTaxable: boolean;
  improvementValue: number | null;
  marketValue: number | null; // only where the county gives one separately (Morgan TotalValue)
  currentUseValue: number | null; // Colbert
  hasCurrentUse: boolean | null; // Colbert
  assessmentClass: number | null; // Morgan
  timberAcres: number | null;
  calcAcres: number | null;
  deededAcres: number | null;
  taxDistrict: string | null;
  taxDue: number | null;
  owner: string | null;
  mailing: string | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function first(a: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (a[k] !== undefined && a[k] !== null && a[k] !== "") return a[k];
  return null;
}

export function readCountyRecord(attributes: Record<string, unknown> | null | undefined): CountyRecord | null {
  if (!attributes) return null;
  const a = attributes;
  const yearRaw = num(first(a, ["TaxYearDue", "RecordYear", "CurrentYear"]));
  const assessed = num(first(a, ["TAV", "AssdValue"]));
  const cls = num(a.AssessmentClass);
  // Class III is 10%, Class II 20%. Without a class, assume 10% (farm and
  // forest), the class every parcel of this kind should be in.
  const ratio = cls === 2 ? 0.2 : 0.1;
  const hcu = str(a.HasCurrentUse);
  // The first POSITIVE acreage: some layers carry a zero placeholder
  // (Colbert's CALC_ACRE is 0, its GIS_Acres is the real figure).
  const calc =
    ["CALC_ACRE", "CalcAcres", "GIS_Acres", "TotalAcres"]
      .map((k) => num(a[k]))
      .find((v): v is number => v !== null && v > 0) ?? null;
  const mailing = [str(a.MailAdd1), str(a.MailAdd2), str(a.MailCity), str(a.MailState), str(first(a, ["MailZip1", "MailZip"]))]
    .filter(Boolean)
    .join(" ");
  return {
    year: yearRaw && yearRaw > 1900 ? yearRaw : null,
    assessed,
    taxableValue: assessed !== null ? Math.round(assessed / ratio) : null,
    landValue: num(first(a, ["CLandValue", "TotalLandValue"])),
    landValueIsTaxable: num(a.CLandValue) !== null,
    improvementValue: num(first(a, ["CImpValue", "TotalImpValue"])),
    marketValue: num(a.TotalValue),
    currentUseValue: num(a.CurrentUseValue),
    hasCurrentUse: hcu === null ? null : /^(true|y|yes|1)$/i.test(hcu),
    assessmentClass: cls,
    timberAcres: num(first(a, ["TimberAcres", "TimberAcreage"])),
    calcAcres: calc && calc > 0 ? calc : null,
    deededAcres: (() => {
      const d = num(a.DeededAcres);
      return d && d > 0 ? d : null;
    })(),
    taxDistrict: str(a.TaxDist),
    taxDue: num(a.TotalTaxDue),
    owner: str(a.Owner),
    mailing: mailing || null,
  };
}

// Taxable LAND value per acre: the current use test. Improvements come
// off (a house does not make land market-valued).
export function landValuePerAcre(r: CountyRecord, acres: number | null): number | null {
  if (!acres || acres <= 0) return null;
  // Buildings can sit in a different class (a shop at 20%), so working
  // back from the assessed total overstates the land; use the county's
  // own taxable land value where it gives one.
  let land: number | null = null;
  if (r.landValueIsTaxable && r.landValue !== null) land = r.landValue;
  else if (r.taxableValue !== null) land = r.taxableValue - (r.improvementValue ?? 0);
  else if (r.landValue !== null) land = r.landValue;
  if (land === null || land < 0) return null;
  return land / acres;
}
