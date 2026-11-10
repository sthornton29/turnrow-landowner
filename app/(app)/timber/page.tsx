import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatNumber } from "@/lib/format";
import { STAND_TYPE_LABELS } from "@/lib/assetTypes";
import RowEditor from "@/components/lists/RowEditor";
import { lastYearOf } from "@/lib/standActivities";
import {
  PLAN_NOTE,
  REC_STATUS_LABELS,
  compareRecs,
  planForStand,
  windowText,
  type Recommendation,
} from "@/lib/timberPlan";
import { activitiesForStand, loadStandActivities } from "@/lib/timberRecords";

const STATUS_CHIP: Record<string, string> = {
  overdue: "bg-red-100 text-red-800",
  due: "bg-amber-100 text-amber-900",
  scheduled: "bg-sky-100 text-sky-900",
  upcoming: "bg-kelly-100 text-pine-900",
  later: "bg-gray-100 text-gray-600",
};

export const metadata = { title: "Timber" };

export default async function TimberPage() {
  const { supabase } = await requireOrg();

  const [{ data: stands }, { data: properties }] = await Promise.all([
    supabase
      .from("timber_stands")
      .select("id, property_id, name, stand_type, species, year_established, site_index, site_index_base_age, tpa_planted, management_goal, last_thinning_year, last_burn_year, notes, acres")
      .order("name"),
    supabase.from("properties").select("id, name").order("name"),
  ]);

  const totalAcres = (stands ?? []).reduce((s, t) => s + (t.acres ?? 0), 0);

  // Timber records (migration 0045): each stand's history drives its
  // schedule; the card up top gathers what needs attention.
  const nowYear = new Date().getFullYear();
  const allActivities = await loadStandActivities(supabase);
  const standInfo = new Map(
    (stands ?? []).map((st) => {
      const acts = activitiesForStand(allActivities, st.id);
      return [
        st.id,
        {
          recs: planForStand(st, acts, nowYear),
          lastThin: lastYearOf(acts, ["thinning"], st.last_thinning_year),
          lastBurn: lastYearOf(acts, ["prescribed_burn"], st.last_burn_year),
          planted: lastYearOf(acts, ["planting"], st.year_established),
        },
      ];
    })
  );
  const propertyName = new Map((properties ?? []).map((p) => [p.id, p.name]));
  const standById = new Map((stands ?? []).map((st) => [st.id, st]));
  const allRecs = Array.from(standInfo.values()).flatMap((i) => i.recs);
  // Field work that needs attention, one line each; the low-priority
  // routine items (yearly walks, forester walk-throughs) group into one
  // line per kind so 15 stands do not mean 15 reminders.
  const attention = allRecs
    .filter((r) => r.priority !== "low" && r.status !== "later" && !r.setupOnly)
    .sort(compareRecs);
  // Stands missing the facts a schedule needs: one line, not one each.
  const needsYear = allRecs.filter((r) => r.setupOnly);
  const routine = new Map<string, Recommendation[]>();
  for (const r of allRecs) {
    if (r.priority !== "low" || r.status === "later" || r.status === "upcoming") continue;
    routine.set(r.title, [...(routine.get(r.title) ?? []), r]);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Timber</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            {formatNumber((stands ?? []).length)} stands, {formatAcres(totalAcres)} total acres
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/timber/basis"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Timber basis
          </Link>
          <Link
            href="/timber-sales"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Timber sales
          </Link>
        </div>
      </div>

      {(stands ?? []).length > 0 && (attention.length > 0 || routine.size > 0 || needsYear.length > 0) ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-base font-semibold text-gray-900">Upcoming on your land</h2>
          <ul className="space-y-1.5 text-sm">
            {needsYear.length > 0 ? (
              <li className="text-gray-700">
                <span className="font-medium text-gray-900">
                  Add the planting year to {needsYear.length} pine stand{needsYear.length === 1 ? "" : "s"}
                </span>{" "}
                to see their thinning, burn, and harvest timing:{" "}
                {needsYear.map((r, i) => (
                  <span key={r.standId}>
                    {i > 0 ? ", " : ""}
                    <Link href={`/timber/${r.standId}`} className="text-kelly-700 hover:underline">
                      {standById.get(r.standId)?.name}
                    </Link>
                  </span>
                ))}
              </li>
            ) : null}
            {attention.slice(0, 12).map((r) => {
              const st = standById.get(r.standId);
              return (
                <li key={`${r.standId}:${r.key}`} className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[r.status]}`}>
                    {REC_STATUS_LABELS[r.status]}
                  </span>
                  <Link href={`/timber/${r.standId}`} className="font-medium text-gray-900 hover:underline">
                    {st?.name}
                  </Link>
                  <span className="text-gray-700">{r.title}</span>
                  <span className="text-gray-500">
                    {windowText(r)}
                    {st ? ` · ${propertyName.get(st.property_id) ?? ""}` : ""}
                  </span>
                </li>
              );
            })}
            {attention.length > 12 ? (
              <li className="text-gray-500">and {attention.length - 12} more on the stand pages</li>
            ) : null}
            {Array.from(routine.entries()).map(([kind, recs]) => (
              <li key={kind} className="text-gray-600">
                <span className="font-medium text-gray-800">{kind}</span>
                {": "}
                {recs.length} stand{recs.length === 1 ? "" : "s"} (
                {recs
                  .slice(0, 6)
                  .map((r) => standById.get(r.standId)?.name)
                  .filter(Boolean)
                  .join(", ")}
                {recs.length > 6 ? ", ..." : ""})
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">{PLAN_NOTE}</p>
        </section>
      ) : null}

      {(stands ?? []).length === 0 ? (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          <p>
            No timber stands yet. The fastest start: run{" "}
            <span className="font-semibold text-pine-900">Timber Scan</span> on
            a property; it proposes stand boundaries from USDA land cover,
            already broken into pine, hardwood, and mixed, for you to correct
            and confirm.
          </p>
          {(properties ?? []).length > 0 ? (
            <p className="flex flex-wrap justify-center gap-2">
              {(properties ?? []).slice(0, 4).map((p) => (
                <Link
                  key={p.id}
                  href={`/timber-scan/${p.id}`}
                  className="rounded-lg border border-pine-800 px-3 py-1.5 font-medium text-pine-900 hover:bg-kelly-50"
                >
                  Scan {p.name}
                </Link>
              ))}
            </p>
          ) : null}
          <p>
            You can also draw stands on the{" "}
            <Link href="/map" className="font-medium text-kelly-700 hover:underline">
              map
            </Link>{" "}
            (Add, then Boundary, then Timber) or assign imported boundaries as
            timber stands on the{" "}
            <Link href="/import" className="font-medium text-kelly-700 hover:underline">
              import page
            </Link>
            .
          </p>
        </div>
      ) : (
        (properties ?? [])
          .filter((p) => (stands ?? []).some((s) => s.property_id === p.id))
          .map((p) => {
            const propertyStands = (stands ?? []).filter((s) => s.property_id === p.id);
            const acres = propertyStands.reduce((s, t) => s + (t.acres ?? 0), 0);
            return (
              <section key={p.id}>
                <h2 className="mb-2 text-base font-semibold text-gray-900">
                  <Link href={`/properties/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>{" "}
                  <span className="text-sm font-normal text-gray-500">
                    {formatNumber(propertyStands.length)} stands · {formatAcres(acres)} ac
                  </span>
                </h2>
                <ul className="space-y-2">
                  {propertyStands.map((s) => {
                    const info = standInfo.get(s.id);
                    const next = info?.recs.find((r) => r.priority !== "low") ?? null;
                    return (
                    <li key={s.id} className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link
                          href={`/timber/${s.id}`}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          {s.name}
                        </Link>
                        <span className="text-sm text-pine-900">{formatAcres(s.acres)} ac</span>
                      </div>
                      <p className="text-sm text-gray-500">
                        {[
                          s.stand_type ? STAND_TYPE_LABELS[s.stand_type] : null,
                          s.species,
                          info?.planted != null
                            ? `planted ${info.planted} (age ${Math.max(0, nowYear - info.planted)})`
                            : null,
                          info?.lastThin != null ? `thinned ${info.lastThin}` : null,
                          info?.lastBurn != null ? `burned ${info.lastBurn}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No stand info yet"}
                      </p>
                      {next ? (
                        <p className="mt-0.5 text-sm">
                          <span className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[next.status]}`}>
                            {REC_STATUS_LABELS[next.status]}
                          </span>
                          <span className="text-gray-700">
                            Next: {next.title}, {windowText(next)}
                          </span>
                        </p>
                      ) : null}
                      {s.notes ? <p className="mt-1 text-sm text-gray-600">{s.notes}</p> : null}
                      <RowEditor entityType="timber_stand" row={s} />
                    </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
      )}
    </div>
  );
}
