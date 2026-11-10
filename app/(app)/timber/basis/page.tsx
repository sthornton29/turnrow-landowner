import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars } from "@/lib/format";
import {
  ACQUISITION_LABELS,
  BASIS_NOTE,
  BASIS_SOURCE_LABELS,
  accountBalance,
  type AcquisitionType,
  type BasisSource,
} from "@/lib/timberBasis";
import type {
  TimberAccountEntryRow,
  TimberAccountProductRow,
  TimberAccountRow,
} from "@/types/db";
import BasisSetupLauncher from "@/components/timber/BasisSetupLauncher";

export const metadata = { title: "Timber basis" };

// TIMBER BASIS (migration 0046): one card per property with timber.
// Each shows its basis account(s), or the setup interview. The point,
// in one line: basis is the part of a timber sale you do not pay tax on.

export default async function TimberBasisPage() {
  const { supabase, profile } = await requireOrg();
  const orgId = profile.organization_id!;

  const [
    { data: properties },
    { data: stands },
    { data: entities },
    { data: accounts },
    { data: products },
    { data: entries },
  ] = await Promise.all([
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("timber_stands").select("id, property_id, acres"),
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("timber_accounts").select("*").order("name"),
    supabase.from("timber_account_products").select("*"),
    supabase.from("timber_account_entries").select("*"),
  ]);

  const acresByProperty = new Map<string, number>();
  for (const s of stands ?? []) {
    acresByProperty.set(s.property_id, (acresByProperty.get(s.property_id) ?? 0) + (s.acres ?? 0));
  }
  const accts = (accounts ?? []) as TimberAccountRow[];
  const prods = (products ?? []) as TimberAccountProductRow[];
  const ents = (entries ?? []) as TimberAccountEntryRow[];
  const entityName = new Map((entities ?? []).map((e) => [e.id, e.name]));
  const withTimber = (properties ?? []).filter(
    (p) => acresByProperty.has(p.id) || accts.some((a) => a.property_id === p.id)
  );
  const setUp = withTimber.filter((p) => accts.some((a) => a.property_id === p.id)).length;
  const totalBasis = accts.reduce(
    (s, a) =>
      s +
      accountBalance(
        prods.filter((p) => p.account_id === a.id),
        ents.filter((e) => e.account_id === a.id)
      ).basis,
    0
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <p className="text-sm text-gray-500">
          <Link href="/timber" className="hover:underline">
            Timber
          </Link>{" "}
          /
        </p>
        <h1 className="text-xl font-semibold text-gray-900">Timber basis</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          {setUp} of {withTimber.length} properties set up
          {accts.length > 0 ? ` · ${formatDollars(totalBasis)} of basis on record` : ""}
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <p>
          <span className="font-semibold text-gray-900">Why this matters.</span> When timber sells, tax
          is owed on the proceeds minus selling costs minus your <span className="font-medium">basis</span>{" "}
          in the timber that was cut (the &quot;depletion&quot;). With no basis on record, the IRS treats
          it as zero and the whole check is taxed. Set each tract up once: how the land was acquired,
          when, and how much of its value was timber. Turnrow then works out the depletion at every
          sale for you to confirm.
        </p>
        <p className="mt-2 text-xs text-gray-500">{BASIS_NOTE}</p>
      </section>

      {withTimber.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No timber stands yet. Add stands on the{" "}
          <Link href="/timber" className="font-medium text-kelly-700 hover:underline">
            Timber page
          </Link>{" "}
          first.
        </p>
      ) : (
        <ul className="space-y-3">
          {withTimber.map((p) => {
            const mine = accts.filter((a) => a.property_id === p.id);
            return (
              <li key={p.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-gray-900">
                    <Link href={`/properties/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                    <span className="ml-2 text-sm font-normal text-gray-500">
                      {formatAcres(acresByProperty.get(p.id) ?? 0)} ac of stands
                      {p.entity_id ? ` · ${entityName.get(p.entity_id) ?? ""}` : ""}
                    </span>
                  </h2>
                </div>
                {mine.length === 0 ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm text-gray-600">No timber basis set up yet.</p>
                    <BasisSetupLauncher
                      orgId={orgId}
                      label="Set up timber basis"
                      property={p}
                      entities={entities ?? []}
                      account={null}
                      products={[]}
                      defaultAcres={acresByProperty.get(p.id) ?? null}
                    />
                  </div>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {mine.map((a) => {
                      const bal = accountBalance(
                        prods.filter((x) => x.account_id === a.id),
                        ents.filter((e) => e.account_id === a.id)
                      );
                      const acq = ACQUISITION_LABELS[a.acquisition_type as AcquisitionType];
                      return (
                        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                          <Link href={`/timber/basis/${a.id}`} className="font-medium text-gray-900 hover:underline">
                            {a.name}
                          </Link>
                          <span className="text-gray-600">
                            {[
                              acq?.label,
                              a.acquired_date?.slice(0, 4),
                              a.entity_id ? entityName.get(a.entity_id) : null,
                              BASIS_SOURCE_LABELS[a.basis_source as BasisSource],
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="ml-auto font-semibold text-pine-900">
                            Basis left {formatDollars(bal.basis)}
                          </span>
                          {a.basis_source === "unknown" || bal.openingBasis === 0 ? (
                            <span className="w-full text-xs text-amber-800">
                              No timber value on record yet. A consulting forester can do a retroactive
                              appraisal as of {a.acquired_date ? a.acquired_date.slice(0, 4) : "the date you acquired it"}.
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
