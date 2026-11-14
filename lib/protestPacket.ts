// PROTEST PACKET: everything for one parcel that an owner brings to the
// county Board of Equalization (or the revenue commissioner, for class and
// current use questions), gathered from the tax report (lib/taxReport.ts).
// Pure: the PDF (components/taxes/protestPacketPdf.ts) only draws this.
// The packet prepares; the owner decides, signs, and files.

import { formatAcres, formatDate } from "./format";
import type { Finding, ParcelRow, TaxReport } from "./taxReport";

// Printed on page 1 of the packet and near the top of the tax report.
export const WORKSHEET_NOTE =
  "This is a worksheet to help you prepare, not legal or tax advice. Confirm deadlines and figures with the county.";

const USE_NOTICE_DEADLINE = "Use the deadline printed on your notice; confirm with the county Board of Equalization.";

export interface PacketGround {
  heading: string;
  text: string;
  dollars: number | null; // a year, an estimate
  // Board of Equalization (the only grounds that go in the letter), the
  // revenue commissioner / assessor, or background for the owner's own
  // review (shown in the packet, never in the letter).
  forWhom: "board" | "assessor" | "background";
}

export interface ProtestPacket {
  parcelId: string;
  parcelNumber: string;
  county: string;
  propertyName: string;
  owner: string; // entity name, else the county's owner name
  countyOwner: string | null;
  mailing: string | null;
  // The tax year the notice values: the logged notice's year when a
  // notice is open, else the year of the county record on file.
  valuationYear: number;
  billYear: number; // the report year (bills on file)
  preparedOn: string; // ISO date
  // Counted as 30 days from the logged notice date; the notice itself
  // prints the deadline that governs.
  deadline: { date: string; noticeDate: string } | null;
  // No open window, and the latest notice's window closed within the last
  // year: said plainly instead of falling back to the generic text.
  windowClosed: { noticeDate: string; closedOn: string } | null;
  // Set when the county record on file is older than the notice.
  recordNote: string | null;
  disclaimer: string;
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

function groundFor(f: Finding, p: ParcelRow): PacketGround | null {
  const d = f.dollars ?? null;
  switch (f.kind) {
    case "current_use":
      return {
        heading: "Current use classification",
        // Protests are about market value; current use is applied for with
        // the county assessing official (research note, "Appeals").
        text: `${f.detail} Current use is applied for with the county revenue commissioner on form cuapp, between Oct 1 and the last business day of December. It is not decided by a protest: a protest to the Board of Equalization is about market value. Confirm the form and the dates with the county.`,
        dollars: d,
        forWhom: "assessor",
      };
    case "acreage": {
      // A ground only when the county taxes MORE acres than the deed (or
      // than the map, when no deed figure is on file), by more than the
      // 2 acres the acreage finding itself treats as a real difference.
      // The county counting fewer acres is no reason a value is too high,
      // and saying so would tell the Board more land is held than taxed.
      const countyAcres = p.record?.calcAcres ?? null;
      const ownAcres = p.deededAcres ?? p.gisAcres;
      if (!countyAcres || !ownAcres || countyAcres <= ownAcres + 2) return null;
      return {
        heading: "Acreage",
        text: `The county record counts ${formatAcres(countyAcres)} acres for this parcel; ${
          p.deededAcres
            ? `the deed gives ${formatAcres(p.deededAcres)} acres.`
            : `the owner's map of the parcel measures ${formatAcres(ownAcres)} acres (no deed figure is on file).`
        }`,
        dollars: d,
        forWhom: "board",
      };
    }
    case "tax_jump":
      // Two tax amounts, not two values: background for the owner, not a
      // reason to give the Board.
      return {
        heading: "Tax increase",
        text: `${f.detail} The bills on file show the tax, not whether the county's value changed; compare this year's valuation notice with last year's value before raising it.`,
        dollars: d,
        forWhom: "background",
      };
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
    // property id -> entity id, so comparables stay with one owner.
    propertyEntity: Map<string, string | null>;
  }
): ProtestPacket | null {
  const p = report.parcels.find((x) => x.id === parcelId);
  if (!p) return null;
  const rec = p.record;
  const county = p.county ?? "";
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // This parcel's notices: its own, else the county-wide ones.
  const mine = report.noticeWindows.filter((n) => n.parcelId === parcelId || (!n.parcelId && n.county === county));
  const open = mine.filter((n) => n.open);
  const notice = open.find((n) => n.parcelId === parcelId) ?? open.find((n) => !n.parcelId) ?? null;
  // With no open window, the latest notice whose window closed in the
  // last year is named, so the packet does not quietly read as if no
  // notice had come.
  const yearAgo = new Date(ctx.today.getFullYear() - 1, ctx.today.getMonth(), ctx.today.getDate());
  const closed = notice
    ? null
    : (mine
        .filter((n) => !n.open && n.deadline >= iso(yearAgo))
        .sort((a, b) => b.noticeDate.localeCompare(a.noticeDate))[0] ?? null);
  // The notice says which tax year is being valued; the county record on
  // file can be a year behind it.
  const valuationYear = notice?.taxYear ?? rec?.year ?? report.year + 1;
  const recordNote =
    notice && rec?.year && rec.year < notice.taxYear
      ? `The county record on file is for ${rec.year}, older than the ${notice.taxYear} notice, so the county figures in this packet may not match the notice. Use the values printed on the notice.`
      : null;

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
  add("Timber acres (county)", p.timberAcres !== null ? formatAcres(p.timberAcres) : null);
  add("Land value (county)", rec?.landValue ? money(rec.landValue) : null);
  add("Buildings value (county)", rec?.improvementValue ? money(rec.improvementValue) : null);
  add("Market value (county)", rec?.marketValue ? money(rec.marketValue) : null);
  add("Current use value (county)", rec?.currentUseValue ? money(rec.currentUseValue) : null);
  add(rec?.taxableValueEstimated ? "Taxable value (estimated)" : "Taxable value", rec?.taxableValue ? money(rec.taxableValue) : null);
  add("Assessed value", rec?.assessed ? money(rec.assessed) : null);
  add("Taxable land value per acre", p.landPerAcre !== null ? money(p.landPerAcre) : null);
  add("Current use value per acre (best soil class)", p.cuCeiling ? money(p.cuCeiling) : null);
  add("Current use status", STATUS[p.cuStatus]);
  add("Tax district", rec?.taxDistrict);
  add("Millage", p.mills ? `${p.mills} mills${p.millsVerified ? "" : " (not verified against a bill)"}` : null);
  add(`${report.year} tax (bills on file)`, p.tax ? cents(p.tax) : null);
  add(`${report.year - 1} tax`, p.priorTax ? cents(p.priorTax) : null);
  add(`${rec?.year ?? valuationYear} tax (county record)`, rec?.taxDue ? cents(rec.taxDue) : null);

  const grounds = report.findings
    .filter((f) => f.parcelId === parcelId)
    .map((f) => groundFor(f, p))
    .filter((g): g is PacketGround => g !== null);

  // Comparables: the owner's other parcels in the same county with a
  // known taxable land value per acre, closest in size first. "The
  // owner's" means the same entity: under "All entities" the report holds
  // every family entity's parcels, and another entity's land does not
  // belong in this owner's filing. A parcel with no entity compares only
  // within its own property.
  const entityOf = (propertyId: string | null) => (propertyId ? (ctx.propertyEntity.get(propertyId) ?? null) : null);
  const owningEntity = entityOf(p.propertyId);
  const sameOwner = (x: ParcelRow) =>
    owningEntity ? entityOf(x.propertyId) === owningEntity : x.propertyId !== null && x.propertyId === p.propertyId;
  const size = p.acres ?? 0;
  const comparables = report.parcels
    .filter((x) => x.id !== p.id && x.county === p.county && x.landPerAcre !== null && x.parcelNumber !== p.parcelNumber && sameOwner(x))
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
    `Re: Parcel ${p.parcelNumber}, ${valuationYear} valuation${notice ? `, notice dated ${formatDate(notice.noticeDate)}` : ""}`,
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
      ? `File in writing with the ${county} County Board of Equalization by ${formatDate(notice.deadline)}, 30 days from the notice dated ${formatDate(notice.noticeDate)}. ${USE_NOTICE_DEADLINE}`
      : closed
        ? `The window for the notice dated ${formatDate(closed.noticeDate)} closed on ${formatDate(closed.deadline)}. Ask the county Board of Equalization whether anything can still be filed; if not, keep this packet for the next notice.`
        : `File in writing with the ${county} County Board of Equalization, usually within 30 days of the valuation notice. ${USE_NOTICE_DEADLINE} Log the notice date in the tax report to see the date counted from it.`,
    ...(recordNote ? [recordNote] : []),
    "Attach a copy of the valuation notice and keep a copy of everything filed, with the date filed.",
    "Bring the deed and survey or plat if acres are in question, and recent sales, appraisals, or timber cruises if value is.",
    ...(grounds.some((g) => g.heading === "Current use classification")
      ? ["Current use: apply with the revenue commissioner on form cuapp between Oct 1 and the last business day of December (Jan 1 is a holiday); confirm the dates with the county. A new owner (including a new LLC or trust) must apply again."]
      : []),
    "Taxes are still due on time while a protest is pending. If the Board's ruling is not acceptable, an appeal to circuit court is due within 30 days of the ruling. An appeal has its own filing requirements (written notice and a bond), so speak with an attorney well before the 30 days run.",
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
    deadline: notice ? { date: notice.deadline, noticeDate: notice.noticeDate } : null,
    windowClosed: closed ? { noticeDate: closed.noticeDate, closedOn: closed.deadline } : null,
    recordNote,
    disclaimer: WORKSHEET_NOTE,
    facts,
    grounds,
    history: p.history,
    comparables,
    cuTable,
    letter,
    checklist,
  };
}
