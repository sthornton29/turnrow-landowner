import Link from "next/link";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  PAYMENT_STATUS_LABELS,
  STATUS_BADGE_CLASSES,
  VALUE_SOURCE_LABELS,
  type ValueSource,
} from "@/lib/leaseLogic";
import type { CropStep, Factor, LeaseYearExplanation } from "@/lib/leaseExplain";

// The breakdown page's body: one lease-year explained as a short
// sentence, an equation strip per step (each factor with where it came
// from), what has been received against it, and a legend for the
// sources. Server-renderable; no state.

// ---------------------------------------------------------------- formatting

function formatFactor(f: Factor): string {
  if (f.value === null) return "missing";
  switch (f.unit) {
    case "ac":
      return `${formatAcres(f.value)} ac`;
    case "%":
      return `${formatNumber(f.value)}%`;
    case "$":
      return formatDollars(f.value);
    case "$/ac":
      return `${formatDollars(f.value)}/ac`;
    default:
      if (f.unit.startsWith("$/")) {
        // Prices: cents matter on grain, fractions of a cent on cotton.
        const v = f.value;
        const text =
          v < 1
            ? "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
            : formatDollars(v);
        return `${text}/${f.unit.slice(2)}`;
      }
      if (f.unit.endsWith("/ac")) {
        return `${formatNumber(Math.round(f.value * 10) / 10)} ${f.unit}`;
      }
      return `${formatNumber(f.value)} ${f.unit}`;
  }
}

function asOfText(s: ValueSource | null): string | null {
  if (!s?.as_of) return null;
  const d = new Date(s.as_of);
  return Number.isNaN(d.getTime()) ? s.as_of : d.toLocaleDateString();
}

// ---------------------------------------------------------------- source chips

const SOURCE_CHIP: Record<string, string> = {
  tenant_actual: "bg-kelly-50 text-pine-900 ring-kelly-100",
  tenant_final: "bg-kelly-50 text-pine-900 ring-kelly-100",
  tenant_projected: "bg-amber-50 text-amber-800 ring-amber-100",
  hand: "bg-gray-100 text-gray-700 ring-gray-200",
  terms: "bg-gray-100 text-gray-700 ring-gray-200",
};

function SourceChip({ factor }: { factor: Factor }) {
  if (factor.value === null) {
    return (
      <span className="inline-block rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-100">
        Missing
      </span>
    );
  }
  const key = factor.fromTerms ? "terms" : (factor.source?.kind ?? "hand");
  const label = factor.fromTerms
    ? "Lease terms"
    : factor.source
      ? VALUE_SOURCE_LABELS[factor.source.kind].replace(/^\w/, (c) => c.toUpperCase())
      : "Entered by hand";
  const asOf = factor.fromTerms ? null : asOfText(factor.source);
  return (
    <span
      className={"inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 " + SOURCE_CHIP[key]}
      title={asOf ? `As of ${asOf}` : undefined}
    >
      {label}
      {asOf ? <span className="font-normal opacity-80"> · {asOf}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------- equation strip

type EqItem =
  | { kind: "factor"; factor: Factor }
  | { kind: "op"; text: string }
  | { kind: "result"; label: string; value: number | null; unit?: string; final?: boolean };

function FactorBox({ factor }: { factor: Factor }) {
  return (
    <div className="min-w-[7.5rem] rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className={"text-lg font-semibold tabular-nums " + (factor.value === null ? "text-red-600" : "text-gray-900")}>
        {formatFactor(factor)}
      </p>
      <p className="text-xs text-gray-500">{factor.label}</p>
      <div className="mt-1">
        <SourceChip factor={factor} />
      </div>
    </div>
  );
}

function ResultBox({ label, value, unit, final }: { label: string; value: number | null; unit?: string; final?: boolean }) {
  const text =
    value === null
      ? "not yet"
      : unit
        ? `${formatNumber(Math.round(value))} ${unit}`
        : formatDollars(value);
  return (
    <div
      className={
        "min-w-[7.5rem] rounded-lg px-3 py-2 " +
        (final
          ? "border border-kelly-500 bg-kelly-50"
          : "border border-dashed border-gray-300 bg-gray-50")
      }
    >
      <p className={"text-lg font-semibold tabular-nums " + (value === null ? "text-gray-400" : final ? "text-pine-900" : "text-gray-900")}>
        {text}
      </p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

// Each operator travels with the box after it, so a wrapped strip
// breaks before an operator and never leaves one dangling at a line end.
function Equation({ items }: { items: EqItem[] }) {
  const groups: Array<{ op: string | null; box: Exclude<EqItem, { kind: "op" }> }> = [];
  let pendingOp: string | null = null;
  for (const it of items) {
    if (it.kind === "op") pendingOp = it.text;
    else {
      groups.push({ op: pendingOp, box: it });
      pendingOp = null;
    }
  }
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {groups.map((g, i) => (
        <div key={i} className="flex items-stretch gap-2">
          {g.op ? (
            <div className="flex items-center px-0.5 text-lg font-medium text-gray-400">{g.op}</div>
          ) : null}
          {g.box.kind === "factor" ? (
            <FactorBox factor={g.box.factor} />
          ) : (
            <ResultBox label={g.box.label} value={g.box.value} unit={g.box.unit} final={g.box.final} />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- crop step

function CropCard({ step, sharesExpenses }: { step: CropStep; sharesExpenses: boolean }) {
  const practice = step.practice !== "blended" ? ` · ${step.practice}` : "";
  const items: EqItem[] = [
    { kind: "factor", factor: step.acres },
    { kind: "op", text: "×" },
    { kind: "factor", factor: step.expectedYield },
    { kind: "op", text: "=" },
    { kind: "result", label: "Production", value: step.production, unit: step.unit },
    { kind: "op", text: "×" },
    { kind: "factor", factor: step.price },
    { kind: "op", text: "=" },
    { kind: "result", label: "Crop value", value: step.cropValue },
    { kind: "op", text: "×" },
    {
      kind: "factor",
      factor: { label: "Your share", value: step.sharePct, unit: "%", source: null, fromTerms: true },
    },
    { kind: "op", text: "=" },
    { kind: "result", label: "Your share", value: step.yourShare, final: !sharesExpenses },
  ];
  if (sharesExpenses) {
    items.push(
      { kind: "op", text: "−" },
      {
        kind: "factor",
        factor: { label: "Your share of expenses", value: step.sharedExpenses ?? 0, unit: "$", source: null },
      },
      { kind: "op", text: "=" },
      { kind: "result", label: "Your rent from this crop", value: step.net, final: true }
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900">
          {step.crop}
          <span className="font-normal text-gray-500">{practice}</span>
        </h3>
        <span className={"text-base font-semibold tabular-nums " + (step.net === null ? "text-gray-400" : "text-pine-900")}>
          {step.net === null ? "Incomplete" : formatDollars(step.net)}
        </span>
      </div>
      <Equation items={items} />
      {step.missing.length > 0 ? (
        <p className="mt-2 text-sm text-red-700">
          Missing {step.missing.join(" and ")} for this crop. Fill it in on the lease page and the year projects.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the body

export default function LeaseBreakdown({
  x,
  leaseId,
  leaseName,
}: {
  x: LeaseYearExplanation;
  leaseId: string;
  leaseName: string;
}) {
  const pct = x.expected > 0 ? Math.min(100, Math.round((x.received / x.expected) * 100)) : 0;
  const basisChip =
    x.basis === "schedule"
      ? "bg-kelly-50 text-pine-900 ring-kelly-100"
      : x.basis === "projection"
        ? "bg-amber-50 text-amber-800 ring-amber-100"
        : x.basis === "incomplete"
          ? "bg-red-50 text-red-700 ring-red-100"
          : "bg-gray-100 text-gray-600 ring-gray-200";

  return (
    <div className="space-y-5">
      {/* The three numbers */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Expected {x.year}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{formatDollars(x.expected)}</p>
          <span className={"mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 " + basisChip}>
            {x.basisLabel}
          </span>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Received</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-pine-900">{formatDollars(x.received)}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-kelly-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-500">{pct}% of expected</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Still to come</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{formatDollars(x.outstanding)}</p>
          <p className="mt-1 text-xs text-gray-500">
            {x.basis === "schedule"
              ? `${x.schedule.filter((s) => s.status !== "paid").length} of ${x.schedule.length} payments open`
              : x.basis === "projection"
                ? "No payment schedule yet"
                : ""}
          </p>
        </div>
      </section>

      {/* In one sentence */}
      <section className="rounded-xl border border-kelly-100 bg-kelly-50 px-4 py-3 text-sm text-pine-900">
        {x.headline}
        {x.basis === "schedule" && x.projection !== null && Math.abs(x.projection - x.expected) > 0.005 ? (
          <span className="text-gray-700">
            {" "}
            The projection from terms and assumptions would be {formatDollars(x.projection)}; refresh the schedule on the lease page to bring it in line.
          </span>
        ) : null}
      </section>

      {/* Step by step */}
      {x.basis !== "none" ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">Step by step</h2>
            <Link href={`/leases/${leaseId}#assumptions`} className="text-sm font-medium text-kelly-700 hover:underline">
              Change the inputs
            </Link>
          </div>

          {x.cash ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <Equation
                items={
                  x.cash.lumpSum
                    ? [
                        { kind: "factor", factor: x.cash.lumpSum },
                        { kind: "op", text: "=" },
                        { kind: "result", label: `Rent for ${x.year}`, value: x.projection, final: true },
                      ]
                    : [
                        { kind: "factor", factor: x.cash.acres },
                        { kind: "op", text: "×" },
                        { kind: "factor", factor: x.cash.rate },
                        { kind: "op", text: "=" },
                        { kind: "result", label: `Rent for ${x.year}`, value: x.projection, final: true },
                      ]
                }
              />
            </div>
          ) : null}

          {x.flex ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <Equation
                items={[
                  { kind: "factor", factor: x.flex.acres },
                  { kind: "op", text: "×" },
                  { kind: "factor", factor: x.flex.baseRate },
                  { kind: "op", text: "=" },
                  { kind: "result", label: "Base rent", value: x.flex.baseTotal },
                  { kind: "op", text: "+" },
                  { kind: "factor", factor: x.flex.bonus },
                  { kind: "op", text: "=" },
                  { kind: "result", label: `Rent for ${x.year}`, value: x.projection, final: true },
                ]}
              />
              {x.flex.bonusDescription ? (
                <p className="mt-3 text-sm text-gray-600">
                  <span className="font-medium text-gray-900">How the bonus works: </span>
                  {x.flex.bonusDescription}. The bonus is an estimate you enter each year; it is not computed from prices.
                </p>
              ) : null}
            </div>
          ) : null}

          {x.hunting ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <Equation
                items={
                  x.hunting.amount
                    ? [
                        { kind: "factor", factor: x.hunting.amount },
                        { kind: "op", text: "=" },
                        { kind: "result", label: `Rent for ${x.year}`, value: x.projection, final: true },
                      ]
                    : [
                        { kind: "factor", factor: x.hunting.acres! },
                        { kind: "op", text: "×" },
                        { kind: "factor", factor: x.hunting.rate! },
                        { kind: "op", text: "=" },
                        { kind: "result", label: `Rent for ${x.year}`, value: x.projection, final: true },
                      ]
                }
              />
            </div>
          ) : null}

          {x.cropShare ? (
            <>
              {x.cropShare.crops.map((c, i) => (
                <CropCard key={i} step={c} sharesExpenses={x.cropShare!.sharesExpenses} />
              ))}
              {x.cropShare.crops.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600">
                  No crops entered for {x.year} yet. Add them on the lease page, or let the tenant's shared plantings fill them in.
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-kelly-500 bg-kelly-50 px-4 py-3">
                <p className="text-sm text-pine-900">
                  {x.cropShare.crops.length > 1
                    ? `All ${x.cropShare.crops.length} crops added together`
                    : "Projected rent"}
                </p>
                <p className="text-xl font-semibold tabular-nums text-pine-900">
                  {x.cropShare.subtotal === null ? "Incomplete" : formatDollars(x.cropShare.subtotal)}
                </p>
              </div>
            </>
          ) : null}

          {x.missing.length > 0 ? (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-medium">Still needed before {x.year} can be projected:</p>
              <ul className="mt-1 list-disc pl-5">
                {x.missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {x.lands.length > 0 ? (
            <p className="text-xs text-gray-500">
              Leased acres: {x.lands.map((l) => `${l.propertyName} ${formatAcres(l.acres)}`).join(", ")} ({formatAcres(x.totalAcres)} in all).
              {x.cropShare
                ? " Crop share uses each crop's own planted acres, not the leased total."
                : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Government share */}
      {x.gov && x.gov.landownerAmount > 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-base font-semibold text-gray-900">Government payments, counted separately</h2>
          <p className="mt-1 text-sm text-gray-600">
            The base acres on this leased land are projected to generate {formatDollars(x.gov.tenantAmount)} in ARC/PLC payments paid in {x.year}. Your {formatNumber(x.gov.sharePct)}% share is {formatDollars(x.gov.landownerAmount)},{" "}
            {x.gov.receivedVia === "tenant_remits" ? "which your tenant remits to you" : "paid to you by FSA directly"}. It shows on the Income page under Government payments, not in this lease's rent.
          </p>
        </section>
      ) : null}

      {/* Payments */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Actual against expected</h2>
          <Link href={`/leases/${leaseId}`} className="text-sm font-medium text-kelly-700 hover:underline">
            Record a payment
          </Link>
        </div>
        {x.schedule.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Due</th>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2 text-right">Expected</th>
                  <th className="px-4 py-2 text-right">Received</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {x.schedule.map((s) => (
                  <tr key={s.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 tabular-nums">{new Date(s.dueDate + "T00:00:00").toLocaleDateString()}</td>
                    <td className="px-4 py-2">{s.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatDollars(s.expected)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatDollars(s.received)}</td>
                    <td className="px-4 py-2">
                      <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + STATUS_BADGE_CLASSES[s.status]}>
                        {PAYMENT_STATUS_LABELS[s.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-gray-600">
            {x.basis === "projection"
              ? "No dated installments yet, so the whole year shows as one projected amount. Generate expected payments on the lease page when you want due dates to track and match checks against."
              : x.basis === "none"
                ? "Nothing expected this year."
                : "No payment schedule yet."}
          </p>
        )}
        {x.unscheduledPayments.length > 0 ? (
          <div className="border-t border-gray-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Payments not tied to a scheduled installment
            </p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {x.unscheduledPayments.map((p, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-gray-700">
                    {new Date(p.date + "T00:00:00").toLocaleDateString()}
                    {p.memo ? <span className="text-gray-500"> · {p.memo}</span> : null}
                  </span>
                  <span className="tabular-nums text-gray-900">{formatDollars(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* Legend */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Where the numbers come from</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-block shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 ring-1 ring-gray-200">Lease terms</span>
            <span>Fixed by the lease: rates, your share percent, whether expenses are shared. Edit lease terms on the lease page.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-block shrink-0 rounded-full bg-kelly-50 px-2 py-0.5 text-[11px] font-medium text-pine-900 ring-1 ring-kelly-100">Tenant actual</span>
            <span>Measured from your tenant's own records after harvest (planted acres, harvested yield). Firm.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-block shrink-0 rounded-full bg-kelly-50 px-2 py-0.5 text-[11px] font-medium text-pine-900 ring-1 ring-kelly-100">Tenant final</span>
            <span>A settlement price your tenant has marked final. Firm.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-block shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-100">Tenant projected</span>
            <span>Your tenant's own estimate for the season. It refreshes automatically every sync, so the number here moves as they revise it.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-block shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 ring-1 ring-gray-200">Entered by hand</span>
            <span>You typed it on the lease page. It is never changed automatically.</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          {leaseName}: the Income page adds this lease's expected and received into the year's totals, split across its properties by leased acres.
        </p>
      </section>
    </div>
  );
}
