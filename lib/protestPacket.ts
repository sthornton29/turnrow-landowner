// PROTEST PACKET: everything for one parcel that an owner brings to the
// county Board of Equalization (or the revenue commissioner, for class and
// current use questions), gathered from the tax report (lib/taxReport.ts).
// Pure: the PDF (components/taxes/protestPacketPdf.ts) only draws this.
// The packet prepares; the owner decides, signs, and files.

import type { Finding, ParcelRow, TaxReport } from "./taxReport";

export interface PacketGround {
  heading: string;
  text: string;
  dollars: number | null; // a year, an estimate
  forWhom: "board" | "assessor"; // Board of Equalization, or revenue commissioner / assessor
}

export interface ProtestPacket {
  parcelId: string;
  parcelNumber: string;
  county: string;
  propertyName: string;
  owner: string; // entity name, else the county's owner name
  countyOwner: string | null;
  mailing: string | null;
  valuationYear: number; // the tax year the notice values
  billYear: number; // the report year (bills on file)
  preparedOn: string; // ISO date
  deadline: { date: string; noticeDate: string } | null;
  facts: Array<[string, string]>;
  grounds: PacketGround[];
  history: Array<{ year: number; value: number | null; kind: string; tax: number }>;
  comparables: Array<{ parcelNumber: string; propertyName: string; acres: number | null; landPerAcre: number; status: string }>;
  cuTable: { year: number; rows: Array<{ landType: string; rating: string; perAcre: number }> } | null;
  letter: string[]; // paragraphs, with blanks for the owner to complete
  checklist: string[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const cents = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<ParcelRow["cuStatus"], string> = {
  confirmed: "On current use (owner confirmed)",
  confirmed_no: "Not on current use (owner confirmed)",
  county_yes: "On current use (county record)",
  county_no: "Not on current use (county record)",
  looks_cu: "Looks like current use",
  looks_market: "Looks like market value",
  unknown: "Unknown",
};

function groundFor(f: Finding): PacketGround | null {
  const d = f.dollars ?? null;
  switch (f.kind) {
    case "current_use":
      return {
        heading: "Current use classification",
        text: `${f.detail} Current use is applied for with the revenue commissioner (form cuapp, Oct 1 to Jan 1), not by protest; a protest can ask the Board to value the land at current use once it qualifies.`,
        dollars: d,
        forWhom: "assessor",
      };
    case "acreage":
      return { heading: "Acreage", text: f.detail, dollars: d, forWhom: "board" };
    case "tax_jump":
      return { heading: "Value increase", text: f.detail, dollars: d, forWhom: "board" };
    case "timber_acres":
      return { heading: "Timber acres", text: f.detail, dollars: d, forWhom: "assessor" };
    case "bill_check":
    case "line_mismatch":
      return { heading: "Bill does not tie out", text: f.detail, dollars: d, forWhom: "assessor" };
    case "owner":
      return { heading: "Owner of record", text: f.detail, dollars: null, forWhom: "assessor" };
    default:
      return null;
  }
}

export function buildProtestPacket(
  report: TaxReport,
  parcelId: string,
  ctx: {
    entityName: string | null;
    today: Date;
    cuValues: Array<{ state: string; tax_year: number; land_type: string; rating: string; value_per_acre: number }>;
    state: string;
  }
): ProtestPacket | null {
  const p = report.parcels.find((x) => x.id === parcelId);
  if (!p) return null;
  const rec = p.record;
  const county = p.county ?? "";
  const valuationYear = rec?.year ?? report.year + 1;
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const notice =
    report.openNotices.find((n) => n.parcelId === parcelId) ??
    report.openNotices.find((n) => !n.parcelId && n.county === county) ??
    null;

  const facts: Array<[string, string]> = [];
  const add = (k: string, v: string | null | undefined) => {
    if (v) facts.push([k, v]);
  };
  add("Parcel", p.parcelNumber);
  add("County", county ? `${county} County, ${ctx.state === "AL" ? "Alabama" : ctx.state}` : null);
  add("Property", p.propertyName || null);
  add("County's owner name", rec?.owner);
  add("Acres: county", rec?.calcAcres ? rec.calcAcres.toFixed(2) : null);
  add("Acres: deed", p.deededAcres ? p.deededAcres.toFixed(2) : null);
  add("Acres: map", p.gisAcres ? p.gisAcres.toFixed(2) : null);
  add("Timber acres (county)", p.timberAcres !== null ? String(p.timberAcres) : null);
  add("Land value (county)", rec?.landValue ? money(rec.landValue) : null);
  add("Buildings value (county)", rec?.improvementValue ? money(rec.improvementValue) : null);
  add("Market value (county)", rec?.marketValue ? money(rec.marketValue) : null);
  add("Current use value (county)", rec?.currentUseValue ? money(rec.currentUseValue) : null);
  add("Taxable value", rec?.taxableValue ? money(rec.taxableValue) : null);
  add("Assessed value", rec?.assessed ? money(rec.assessed) : null);
  add("Taxable land value per acre", p.landPerAcre !== null ? money(p.landPerAcre) : null);
  add("Current use cap per acre (good soil)", p.cuCeiling ? money(p.cuCeiling) : null);
  add("Current use status", STATUS[p.cuStatus]);
  add("Tax district", rec?.taxDistrict);
  add("Millage", p.mills ? `${p.mills} mills${p.millsVerified ? "" : " (not verified against a bill)"}` : null);
  add(`${report.year} tax (bills on file)`, p.tax ? cents(p.tax) : null);
  add(`${report.year - 1} tax`, p.priorTax ? cents(p.priorTax) : null);
  add(`${valuationYear} tax (county record)`, rec?.taxDue ? cents(rec.taxDue) : null);

  const grounds = report.findings
    .filter((f) => f.parcelId === parcelId)
    .map(groundFor)
    .filter((g): g is PacketGround => g !== null);

  // Comparables: the owner's other parcels in the same county with a
  // known taxable land value per acre, closest in size first.
  const size = p.acres ?? 0;
  const comparables = report.parcels
    .filter((x) => x.id !== p.id && x.county === p.county && x.landPerAcre !== null && x.parcelNumber !== p.parcelNumber)
    .sort((a, b) => Math.abs((a.acres ?? 0) - size) - Math.abs((b.acres ?? 0) - size))
    .slice(0, 6)
    .map((x) => ({
      parcelNumber: x.parcelNumber,
      propertyName: x.propertyName,
      acres: x.acres,
      landPerAcre: x.landPerAcre!,
      status: STATUS[x.cuStatus],
    }));

  const cuYear = Math.max(
    -Infinity,
    ...ctx.cuValues.filter((c) => c.state === ctx.state && c.tax_year <= valuationYear).map((c) => c.tax_year)
  );
  const order = ["good", "average", "poor", "nonproductive"];
  const cuTable = Number.isFinite(cuYear)
    ? {
        year: cuYear,
        rows: ctx.cuValues
          .filter((c) => c.state === ctx.state && c.tax_year === cuYear)
          .sort((a, b) => a.land_type.localeCompare(b.land_type) || order.indexOf(a.rating) - order.indexOf(b.rating))
          .map((c) => ({
            landType: c.land_type === "timber" ? "Timber" : "Crop and pasture",
            rating: c.rating[0].toUpperCase() + c.rating.slice(1),
            perAcre: Number(c.value_per_acre),
          })),
      }
    : null;

  const owner = ctx.entityName ?? rec?.owner ?? "the owner";
  const boardGrounds = grounds.filter((g) => g.forWhom === "board");
  const letter = [
    `To the ${county} County Board of Equalization`,
    `Re: Parcel ${p.parcelNumber}, ${valuationYear} valuation${notice ? `, notice dated ${notice.notice_date}` : ""}`,
    `${owner} protests the ${valuationYear} valuation of the parcel above${p.propertyName ? ` (${p.propertyName})` : ""}. The owner believes the value is ${
      boardGrounds.length ? "too high for the reasons below" : "too high"
    }, and asks the Board to set the value at $__________.`,
    ...(boardGrounds.length
      ? boardGrounds.map((g, i) => `${i + 1}. ${g.heading}: ${g.text}`)
      : ["Reasons: ______________________________________________________________"]),
    "The attached pages show the county's own record for the parcel, the values and taxes on the owner's bills by year, and the owner's other parcels in the county for comparison.",
    "Please contact the owner at the address below to schedule a hearing.",
    `Signed: ______________________________   Date: ____________\nFor ${owner}\nAddress: ${rec?.mailing ?? "______________________________"}\nPhone: ______________________`,
  ];

  const checklist = [
    notice
      ? `File in writing with the ${county} County Board of Equalization by ${notice.deadline}, 30 days from the notice dated ${notice.notice_date}.`
      : `File in writing with the ${county} County Board of Equalization within 30 days of the valuation notice. Log the notice date in the tax report to see the deadline.`,
    "Attach a copy of the valuation notice and keep a copy of everything filed, with the date filed.",
    "Bring the deed and survey or plat if acres are in question, and recent sales, appraisals, or timber cruises if value is.",
    ...(grounds.some((g) => g.heading === "Current use classification")
      ? ["Current use: apply with the revenue commissioner on form cuapp between Oct 1 and Jan 1. A new owner (including a new LLC or trust) must apply again."]
      : []),
    "Taxes are still due on time while a protest is pending. If the Board's ruling is not acceptable, an appeal to circuit court is due within 30 days of the ruling.",
  ];

  return {
    parcelId: p.id,
    parcelNumber: p.parcelNumber,
    county,
    propertyName: p.propertyName,
    owner,
    countyOwner: rec?.owner ?? null,
    mailing: rec?.mailing ?? null,
    valuationYear,
    billYear: report.year,
    preparedOn: iso(ctx.today),
    deadline: notice ? { date: notice.deadline, noticeDate: notice.notice_date } : null,
    facts,
    grounds,
    history: p.history,
    comparables,
    cuTable,
    letter,
    checklist,
  };
}
