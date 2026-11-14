import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars, todayISO } from "@/lib/format";
import { allocateToProperties, loadIncomeInputs } from "@/lib/income";
import { CU_STATUS_LABELS, buildTaxReport, deadlineText, type Finding, type ReportParcel } from "@/lib/taxReport";
import { NoticeLog, ParcelFlags, ProtestPacketButton, TaxReportControls } from "@/components/taxes/TaxReportControls";
import { WORKSHEET_NOTE, buildProtestPacket } from "@/lib/protestPacket";

export const metadata = { title: "Property tax report" };

// PROPERTY TAX REPORT: answer first (bottom line), then what to look at
// (findings with dollars and deadlines), then the evidence (current use
// and acreage by parcel, with a protest packet PDF per parcel, benchmarks by property), then next year and the
// calendar. All figures come from lib/taxReport.ts.

const SEV: Record<Finding["severity"], { chip: string; label: string }> = {
  high: { chip: "bg-red-100 text-red-800", label: "Act" },
  medium: { chip: "bg-amber-100 text-amber-900", label: "Ask" },
  low: { chip: "bg-gray-100 text-gray-600", label: "Tidy" },
};

const round10 = (n: number) => Math.round(n / 10) * 10;
const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (f: number | null) => (f === null ? "" : `${(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`);
const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function dollarsText(f: Finding): string | null {
  if (f.dollars === null || f.dollars === undefined) return null;
  if (f.dollarsLow != null && f.dollarsHigh != null && f.dollarsHigh > f.dollarsLow) {
    return `About ${money0(round10(f.dollars))} a year (range ${money0(round10(f.dollarsLow))} to ${money0(round10(f.dollarsHigh))})`;
  }
  return f.kind === "unpaid" || f.kind === "tax_jump" || f.kind === "missing_bill" || f.kind === "bill_check" || f.kind === "owner"
    ? formatDollars(f.dollars)
    : `About ${money0(round10(f.dollars))} a year`;
}

export default async function TaxReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; entity?: string; property?: string; county?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, profile } = await requireOrg();

  const [
    { data: lines, error: linesErr },
    { data: statements, error: statementsErr },
    { data: payments, error: paymentsErr },
    { data: parcels, error: parcelsErr },
    { data: properties, error: propertiesErr },
    { data: entities, error: entitiesErr },
    { data: aliases, error: aliasesErr },
    { data: stands, error: standsErr },
    { data: fields, error: fieldsErr },
    { data: pastures, error: pasturesErr },
    { data: leaseLands, error: leaseLandsErr },
    { data: cuValues, error: cuValuesErr },
    { data: millage, error: millageErr },
    { data: notices, error: noticesErr },
  ] = await Promise.all([
    supabase
      .from("tax_statement_lines")
      .select("id, tax_statement_id, tax_year, tax_due, parcel_id, line_type, appraised_value, market_value, current_use_value"),
    supabase.from("tax_statements").select("id, tax_year, county, amount_due, line_total, delinquent_date, entity_id"),
    supabase.from("tax_payments").select("tax_statement_id, amount, paid_date"),
    supabase.from("parcels").select("id, parcel_number, county, property_id, acres, deeded_acres, attributes, current_use_status, is_homestead"),
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("entity_aliases").select("entity_id, alias"),
    supabase.from("timber_stands").select("property_id, acres"),
    supabase.from("fields").select("property_id, acres"),
    supabase.from("pastures").select("property_id, acres"),
    supabase.from("lease_lands").select("property_id"),
    supabase.from("tax_current_use_values").select("state, tax_year, land_type, rating, value_per_acre"),
    supabase.from("tax_millage_rates").select("state, county, district, tax_year, total_mills, timber_per_acre, dwelling_fee, verified"),
    supabase.from("tax_valuation_notices").select("id, county, tax_year, notice_date, parcel_id").order("notice_date", { ascending: false }),
  ]);

  // The bills, payments, and parcels are the report: if any of them did
  // not load, say so. An empty result here would otherwise read as
  // "$0.00, Paid in full".
  if (linesErr || statementsErr || paymentsErr || parcelsErr || propertiesErr) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 p-4 md:p-6">
        <h1 className="text-xl font-semibold text-gray-900">Property tax report</h1>
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load the tax records, so the report is not shown. Reload the page to try again. Nothing was changed.
        </p>
        <Link href="/taxes" className="text-sm font-medium text-kelly-700 hover:underline">
          Back to Property Taxes
        </Link>
      </div>
    );
  }
  // The rest feed single checks; the report still stands without one of
  // them, but it must say what is missing.
  const notLoaded = [
    entitiesErr || aliasesErr ? "entity names" : null,
    standsErr || fieldsErr || pasturesErr || leaseLandsErr ? "land use (stands, fields, pastures, leases)" : null,
    cuValuesErr ? "the current use value table" : null,
    millageErr ? "millage rates" : null,
    noticesErr ? "valuation notices" : null,
  ].filter((x): x is string => x !== null);

  // Today in Central time (the server clock is UTC, which is already
  // tomorrow every evening).
  const todayIso = todayISO();
  const today = new Date(`${todayIso}T12:00:00`);

  const years = Array.from(new Set((lines ?? []).map((l) => l.tax_year))).sort((a, b) => b - a);
  // Default: the latest year with a full set of bills (more than a handful of lines).
  const counts = new Map<number, number>();
  for (const l of lines ?? []) counts.set(l.tax_year, (counts.get(l.tax_year) ?? 0) + 1);
  const fullYears = years.filter((y) => (counts.get(y) ?? 0) >= 10);
  const year = Number(sp.year) || fullYears[0] || years[0] || Number(todayIso.slice(0, 4));
  const entity = sp.entity ?? "";
  const property = sp.property ?? "";
  const county = sp.county ?? "";

  const props = properties ?? [];
  let scope: Set<string> | null = null;
  if (entity || property) {
    scope = new Set(props.filter((p) => (!entity || p.entity_id === entity) && (!property || p.id === property)).map((p) => p.id));
  }

  const entityNames = new Map<string, string[]>();
  for (const e of entities ?? []) entityNames.set(e.id, [e.name]);
  for (const a of aliases ?? []) entityNames.get(a.entity_id)?.push(a.alias);

  const landUse = new Map<string, { timber: number; crop: number; pasture: number; leased: boolean }>();
  const lu = (pid: string) => {
    const cur = landUse.get(pid) ?? { timber: 0, crop: 0, pasture: 0, leased: false };
    landUse.set(pid, cur);
    return cur;
  };
  for (const s of stands ?? []) lu(s.property_id).timber += Number(s.acres) || 0;
  for (const f of fields ?? []) if (f.property_id) lu(f.property_id).crop += Number(f.acres) || 0;
  for (const p of pastures ?? []) if (p.property_id) lu(p.property_id).pasture += Number(p.acres) || 0;
  for (const l of leaseLands ?? []) lu(l.property_id).leased = true;

  const incomeByProperty = new Map<string, Map<number, number>>();
  try {
    const inputs = await loadIncomeInputs(supabase);
    for (const y of [year]) {
      for (const [pid, t] of allocateToProperties(inputs, y)) {
        const m = incomeByProperty.get(pid) ?? new Map<number, number>();
        m.set(y, t.received);
        incomeByProperty.set(pid, m);
      }
    }
  } catch {
    // Income is context, not essential: the report still renders without it.
  }

  const r = buildTaxReport({
    year,
    today,
    state: "AL",
    propertyScope: scope,
    // One whole entity (no single property): its lines with no parcel
    // (unmatched and personal property) stay in its totals.
    entityId: entity && !property ? entity : null,
    county: county || null,
    lines: lines ?? [],
    statements: statements ?? [],
    payments: payments ?? [],
    parcels: (parcels ?? []) as ReportParcel[],
    properties: props,
    entityNames,
    landUse,
    incomeByProperty,
    cuValues: cuValues ?? [],
    millage: millage ?? [],
    notices: notices ?? [],
  });

  // The notice log shows the last two years of notices, open or closed.
  const noticeRows = (notices ?? [])
    .filter((n) => !county || n.county === county)
    .slice(0, 8)
    .map((n) => {
      const d = new Date(n.notice_date + "T00:00:00");
      d.setDate(d.getDate() + 30);
      const deadline = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { id: n.id, county: n.county, notice_date: n.notice_date, deadline, open: deadline >= todayIso };
    });
  const paidYears = Array.from(new Set(r.paidByYear.map((p) => p.year))).slice(0, 4);
  const historyRows = r.parcels.filter((p) => p.history.some((h) => h.value));
  const entityOfProperty = new Map<string, string | null>(props.map((p) => [p.id, p.entity_id]));
  const entityName = new Map((entities ?? []).map((e) => [e.id, e.name]));
  const packetFor = (parcelId: string, propertyId: string | null) => {
    const eid = propertyId ? entityOfProperty.get(propertyId) : null;
    return buildProtestPacket(r, parcelId, {
      entityName: eid ? (entityName.get(eid) ?? null) : null,
      today,
      cuValues: cuValues ?? [],
      state: "AL",
      propertyEntity: entityOfProperty,
    });
  };

  const counties = Array.from(new Set((parcels ?? []).map((p) => p.county).filter(Boolean))).sort() as string[];
  const scopeName = [
    entity ? (entities ?? []).find((e) => e.id === entity)?.name : "All entities",
    property ? props.find((p) => p.id === property)?.name : null,
    county ? `${county} County` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const b = r.bottom;
  const cuRows = r.parcels.filter((p) => p.record || p.cuStatus.startsWith("confirmed"));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500 print:hidden">
            <Link href="/taxes" className="hover:underline">
              Property taxes
            </Link>{" "}
            /
          </p>
          <h1 className="text-xl font-semibold text-gray-900">Property tax report: {year}</h1>
          <p className="mt-0.5 text-sm text-gray-600">{scopeName}</p>
          <p className="mt-1 max-w-2xl text-sm text-gray-700">{WORKSHEET_NOTE}</p>
          <Link href="/taxes/reread" className="text-xs font-medium text-kelly-700 hover:underline print:hidden">
            Re-read bills for market and current use values
          </Link>
        </div>
        <TaxReportControls
          year={year}
          years={years}
          entity={entity}
          entities={entities ?? []}
          property={property}
          properties={props}
          county={county}
          counties={counties}
        />
      </div>

      {notLoaded.length > 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Could not load {notLoaded.join(", ")}, so the checks that use {notLoaded.length === 1 ? "it" : "them"} are missing from this
          report. Reload the page to try again.
        </p>
      ) : null}

      {/* 1. Bottom line */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">{year} property tax</p>
            <p className="text-2xl font-semibold text-pine-900">{formatDollars(b.tax)}</p>
            <p className="text-xs text-gray-600">
              {/* No lines at all is "nothing on file", never "paid". */}
              {r.coverage.lines === 0
                ? `No ${year} bills on file`
                : b.outstanding > 0.01
                  ? `${formatDollars(b.outstanding)} still open`
                  : "Paid in full"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Change from {year - 1}</p>
            <p className="text-2xl font-semibold text-gray-900">
              {b.change === null ? "None to compare" : `${b.change >= 0 ? "+" : "-"}${formatDollars(Math.abs(b.change))}`}
            </p>
            <p className="text-xs text-gray-600">{b.changePct !== null ? `${b.changePct >= 0 ? "+" : ""}${(b.changePct * 100).toFixed(1)}%` : ""}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Per acre</p>
            <p className="text-2xl font-semibold text-gray-900">{b.perAcre !== null ? formatDollars(b.perAcre) : "n/a"}</p>
            <p className="text-xs text-gray-600">on {formatAcres(b.acres)} acres</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Share of income in Turnrow</p>
            <p className="text-2xl font-semibold text-gray-900">{b.pctIncome !== null ? pct(b.pctIncome) : "n/a"}</p>
            <p className="text-xs text-gray-600">{b.income > 0 ? `of ${money0(b.income)} recorded for ${year}` : "no income recorded"}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-800">{b.reason}</p>
        <p className="mt-1 text-sm text-gray-800">
          {b.findings > 0 ? (
            <>
              <span className="font-semibold">{b.findings} thing{b.findings === 1 ? "" : "s"} worth a look</span>
              {b.atStake > 0 ? `, about ${money0(round10(b.atStake))} a year at stake` : ""}.
            </>
          ) : r.coverage.lines === 0 ? (
            `No ${year} bills are on file yet, so there is nothing to check.`
          ) : (
            "Nothing needs attention."
          )}
          {b.nextDeadline ? ` Next date: ${b.nextDeadline.label} (${fmtDate(b.nextDeadline.date)}).` : ""}
        </p>
      </section>

      {/* 2. Things worth a look */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Things worth a look</h2>
        {r.findings.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">Nothing found.</p>
        ) : (
          <ul className="space-y-2">
            {r.findings.map((f) => {
              const d = dollarsText(f);
              return (
                <li key={f.id} className="break-inside-avoid rounded-xl border border-gray-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEV[f.severity].chip}`}>{SEV[f.severity].label}</span>
                    <span className="font-semibold text-gray-900">{f.title}</span>
                    {d ? <span className="ml-auto font-medium text-pine-900">{d}</span> : null}
                  </div>
                  <p className="mt-1 text-gray-700">{f.detail}</p>
                  <p className="mt-1 text-gray-900">
                    <span className="font-medium">What to do:</span> {f.action}
                    {f.deadline ? <span className="text-gray-600"> {deadlineText(f.deadline, todayIso)}</span> : null}
                  </p>
                  {f.propertyId ? (
                    <Link href={`/properties/${f.propertyId}`} className="text-xs font-medium text-kelly-700 hover:underline print:hidden">
                      Open the property
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3. Current use and acreage */}
      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Current use and acreage</h2>
        <p className="mb-2 text-sm text-gray-600">
          Current use taxes farm and timber land on what it produces, not what it would sell for. The county record&apos;s
          taxable land value per acre shows whether a parcel gets it: current use land is valued near{" "}
          {r.rates.cuYear ? `the ${r.rates.cuYear} state table` : "the state table"}
          {r.rates.cuCropGood !== null && r.rates.cuTimberGood !== null
            ? ` (${money0(r.rates.cuCropGood)} an acre for the best crop and pasture land, ${money0(r.rates.cuTimberGood)} for timber)`
            : ""}
          . Set the &quot;Enrolled?&quot; answer where you know it; it overrides the estimate.
          {r.cuSavesTotal > 0
            ? ` Where a bill shows the market value, current use saves about ${money0(round10(r.cuSavesTotal))} a year on these parcels.`
            : ""}
        </p>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Parcel</th>
                <th className="px-3 py-2 text-right">Acres (county / deed / map)</th>
                <th className="px-3 py-2 text-right">Timber ac</th>
                <th className="px-3 py-2 text-right">Land value / ac</th>
                <th className="px-3 py-2">Current use</th>
                <th className="px-3 py-2 text-right">{year} tax</th>
                <th className="px-3 py-2 text-right">Bill check</th>
              </tr>
            </thead>
            <tbody>
              {cuRows.map((p) => (
                <tr key={p.id} className="break-inside-avoid border-t border-gray-100 align-top">
                  <td className="px-3 py-2">
                    <span className="font-medium text-gray-900">{p.propertyName || "No property"}</span>
                    <span className="block font-mono text-xs text-gray-500">
                      {p.parcelNumber} · {p.county}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {[p.record?.calcAcres, p.deededAcres, p.gisAcres].map((v) => (v ? formatAcres(v) : "-")).join(" / ")}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{p.timberAcres !== null ? formatAcres(p.timberAcres) : "-"}</td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {p.landPerAcre !== null ? `$${p.landPerAcre.toLocaleString("en-US")}` : "-"}
                    {p.cuCeiling ? <span className="block text-xs text-gray-500">best soil class about ${p.cuCeiling.toLocaleString("en-US")}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs font-medium ${
                        p.cuStatus === "looks_market" || p.cuStatus === "county_no" || p.cuStatus === "confirmed_no"
                          ? "text-red-700"
                          : p.cuStatus === "unknown"
                            ? "text-gray-500"
                            : "text-pine-900"
                      }`}
                    >
                      {CU_STATUS_LABELS[p.cuStatus]}
                    </span>
                    {p.savings ? <span className="block text-xs text-gray-600">would save about {money0(round10(p.savings.mid))} a year</span> : null}
                    <ParcelFlags
                      parcelId={p.id}
                      status={(parcels ?? []).find((x) => x.id === p.id)?.current_use_status ?? "unknown"}
                      homestead={!!(parcels ?? []).find((x) => x.id === p.id)?.is_homestead}
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-gray-900">
                    {p.tax ? formatDollars(p.tax) : "-"}
                    {(() => {
                      const pk = packetFor(p.id, p.propertyId);
                      return pk ? <ProtestPacketButton packet={pk} /> : null;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {p.billCheck ? (
                      Math.abs(p.billCheck.diff) <= 1 ? (
                        <span className="text-pine-900">Ties out{p.millsVerified ? "" : " (rate unverified)"}</span>
                      ) : (
                        <span className="text-amber-800">Off {formatDollars(p.billCheck.diff)}</span>
                      )
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Benchmarks by property */}
      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">By property</h2>
        <p className="mb-2 text-sm text-gray-600">
          Current use farm and timber land in rural Lawrence and Colbert usually runs about $1 to $2.60 an acre, a few percent of rent.
        </p>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Property</th>
                <th className="px-3 py-2 text-right">Acres</th>
                <th className="px-3 py-2 text-right">{year} tax</th>
                <th className="px-3 py-2 text-right">Per acre</th>
                <th className="px-3 py-2 text-right">% of income</th>
                <th className="px-3 py-2">Tax by year</th>
              </tr>
            </thead>
            <tbody>
              {r.properties.map((p) => (
                <tr key={p.id || "not-tied"} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">{p.name}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{p.acres > 0 ? formatAcres(p.acres) : "-"}</td>
                  <td className="px-3 py-2 text-right text-gray-900">{formatDollars(p.tax)}</td>
                  <td className={`px-3 py-2 text-right ${p.perAcre !== null && p.perAcre > 4 ? "font-semibold text-amber-800" : "text-gray-700"}`}>
                    {p.perAcre !== null ? formatDollars(p.perAcre) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{p.pctIncome !== null ? pct(p.pctIncome) : "-"}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {p.trend.map((t) => `${String(t.year).slice(2)}: ${t.tax > 0 ? money0(t.tax) : "-"}`).join("  ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4b. Value history from the bills */}
      {historyRows.length > 0 ? (
        <section>
          <h2 className="mb-1 text-lg font-semibold text-gray-900">Values on the bills</h2>
          <p className="mb-2 text-sm text-gray-600">
            The value each year&apos;s bill printed. &quot;Taxed&quot; is the value the tax was figured on; &quot;market&quot; is a
            market value printed beside a lower current use value. Older bills mix the two, so{" "}
            <Link href="/taxes/reread" className="text-kelly-700 hover:underline print:hidden">
              re-reading the bills
            </Link>{" "}
            fills in both where they are printed.
          </p>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Parcel</th>
                  <th className="px-3 py-2">Value by year</th>
                  <th className="px-3 py-2 text-right">Current use saves</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((p) => (
                  <tr key={p.id} className="break-inside-avoid border-t border-gray-100 align-top">
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-900">{p.propertyName || "No property"}</span>
                      <span className="block font-mono text-xs text-gray-500">{p.parcelNumber}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {p.history
                        .filter((h) => h.value)
                        .map((h) => `${String(h.year).slice(2)}: ${money0(h.value!)}${h.kind === "market" ? " market" : h.kind === "taxed" ? "" : " ?"}`)
                        .join("   ")}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900">{p.cuSaves ? `${money0(p.cuSaves)} a year` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* 5. Next year */}
      {r.nextYear ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">{year + 1} bills, from the county records</h2>
          <p className="text-gray-800">
            The county already shows {formatDollars(r.nextYear.total)} for {r.nextYear.covered} of {r.nextYear.parcelsInScope} parcels, against{" "}
            {formatDollars(r.nextYear.thisYear)} for the same parcels in {year} (
            {r.nextYear.thisYear > 0
              ? `${r.nextYear.total >= r.nextYear.thisYear ? "+" : ""}${(((r.nextYear.total - r.nextYear.thisYear) / r.nextYear.thisYear) * 100).toFixed(1)}%`
              : "n/a"}
            ). Alabama has limited yearly increases in taxable value on some classes of property; ask the county whether a cap
            applies to these parcels and how long it lasts.
          </p>
        </section>
      ) : null}

      {/* 6. Deadlines */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Dates to know</h2>
        <ul className="space-y-1 rounded-xl border border-gray-200 bg-white p-4 text-sm">
          {r.deadlines.map((d) => (
            <li key={d.label}>
              <span className="font-medium text-gray-900">{fmtDate(d.date)}</span>: {d.label}.{" "}
              <span className="text-gray-600">{d.detail}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-1 font-semibold text-gray-900">Valuation notices</h3>
          <p className="mb-2 text-sm text-gray-600">
            When a county&apos;s valuation notice arrives, log the date printed on it. A protest to the Board of Equalization is
            usually due within 30 days of that date, and the report counts 30 days down at the top. Use the deadline printed on
            your notice; confirm with the county Board of Equalization.
          </p>
          <NoticeLog orgId={profile.organization_id!} counties={counties} notices={noticeRows} />
        </div>
      </section>

      {/* 6b. For the accountant */}
      <section>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Tax paid by calendar year</h2>
        <p className="mb-2 text-sm text-gray-600">
          For the accountant: property tax counts in the year it was paid, not the year on the bill (a 2025 bill paid in December
          2025 is a 2025 deduction; paid in January 2026, a 2026 one). A bill covering several parcels is split by each
          parcel&apos;s tax.
        </p>
        {r.paidByYear.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No payments recorded.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {paidYears.map((y) => {
              const rows = r.paidByYear.filter((p) => p.year === y);
              const total = rows.reduce((s, p) => s + p.amount, 0);
              return (
                <div key={y} className="break-inside-avoid rounded-xl border border-gray-200 bg-white p-3 text-sm">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="font-semibold text-gray-900">Paid in {y}</span>
                    <span className="font-semibold text-pine-900">{formatDollars(total)}</span>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {rows.map((p) => (
                        <tr key={`${p.entity}|${p.property}`} className="border-t border-gray-100">
                          <td className="py-1 pr-2 text-gray-700">{p.entity}</td>
                          <td className="py-1 pr-2 text-gray-600">{p.property}</td>
                          <td className="py-1 text-right text-gray-900">{formatDollars(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 7. How we figured this */}
      <section className="text-xs text-gray-500">
        <h2 className="mb-1 font-semibold text-gray-700">How we figured this</h2>
        <p>
          Tax amounts come from your uploaded statements ({r.coverage.matched} of {r.coverage.lines} {year} lines matched to a
          parcel). Values, acres, and timber acres come from the county GIS records ({r.coverage.withRecord} of{" "}
          {r.coverage.parcels} parcels). Current use values: Alabama Department of Revenue table{r.rates.cuYear ? ` (${r.rates.cuYear})` : ""}.
          Millage: {r.rates.millageNote} Savings are estimates at average soil; the range runs from good to poor soil. This report
          prepares; you or your accountant act. Nothing is sent to the county.
        </p>
      </section>
    </div>
  );
}
