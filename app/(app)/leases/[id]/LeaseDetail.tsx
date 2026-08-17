"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import {
  LEASE_STATUS_LABELS,
  annualRent,
  generateLeasePayments,
  insuranceProblem,
  type LeaseStatus,
  type LeaseTerms,
  type LeaseType,
  type RentStructure,
  type SchedulePayment,
  type YearAssumptions,
} from "@/lib/leaseLogic";
import LeaseForm from "@/components/leases/LeaseForm";
import PaymentsSection from "@/components/payments/PaymentsSection";
import EntityDocuments from "@/components/documents/EntityDocuments";
import {
  yieldUnitLabel,
  type FarmFieldDataRow,
  type FieldMappingRow,
} from "@/lib/farmDisplay";
import {
  projectedYieldForYear,
  rmaConfigForCrop,
  tenantPriceCard,
  type ProjectedYieldRow,
  type TenantPriceCard,
  type TenantPriceRow,
} from "@/lib/leasePricing";
import {
  RecipeComputeCard,
  RecipeEditor,
  RmaBenchmarkCard,
  TenantPriceCardView,
} from "@/components/leases/PriceMethodCards";
import type { PriceMethod, PriceRecipe, RmaBenchmarkConfig } from "@/lib/leaseLogic";

// Actual yield from a farm connection, offered as a one-click prefill for
// crop share projection assumptions (user still reviews and saves).
export interface FarmActual {
  crop: string;
  yieldPerAcre: number;
  unitLabel: string;
  source: string;
}

interface LeaseRow {
  id: string;
  tenant_id: string;
  lease_type: LeaseType;
  name: string;
  status: LeaseStatus;
  start_date: string | null;
  end_date: string | null;
  auto_renew: boolean;
  termination_notice_days: number | null;
  rent_structure: RentStructure | null;
  terms: LeaseTerms;
  payment_schedule: SchedulePayment[];
  special_provisions: string | null;
}

interface LandLink {
  id: string;
  property_id: string;
  field_id: string | null;
  leased_acres: number;
}

interface AssumptionRow {
  id: string;
  year: number;
  data: YearAssumptions;
}

const inputClass = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";

export default function LeaseDetail({
  orgId,
  lease,
  tenants,
  properties,
  fields,
}: {
  orgId: string;
  lease: LeaseRow;
  tenants: Array<{ id: string; name: string; insurance_on_file: boolean; insurance_expires: string | null }>;
  properties: Array<{ id: string; name: string; acres: number | null }>;
  fields: Array<{ id: string; property_id: string; name: string; acres: number | null }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [lands, setLands] = useState<LandLink[]>([]);
  const [assumptions, setAssumptions] = useState<AssumptionRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-land form state
  const [addPropertyId, setAddPropertyId] = useState(properties[0]?.id ?? "");
  const [addFieldId, setAddFieldId] = useState("");

  const [farmMappings, setFarmMappings] = useState<FieldMappingRow[]>([]);
  const [farmData, setFarmData] = useState<FarmFieldDataRow[]>([]);
  const [farmConnections, setFarmConnections] = useState<
    Array<{ id: string; label: string; scopes: Record<string, boolean> | null }>
  >([]);
  const [marketingPrices, setMarketingPrices] = useState<TenantPriceRow[]>([]);
  const [projectedYields, setProjectedYields] = useState<ProjectedYieldRow[]>([]);

  const load = useCallback(async () => {
    const wantsFarm =
      lease.lease_type === "agricultural" &&
      (lease.rent_structure === "crop_share" || lease.rent_structure === "flex");
    const [l, a, fm, fd, fc, mp, py] = await Promise.all([
      supabase.from("lease_lands").select("*").eq("lease_id", lease.id),
      supabase.from("lease_year_assumptions").select("*").eq("lease_id", lease.id).order("year"),
      wantsFarm
        ? supabase.from("field_mappings").select("*").eq("status", "confirmed")
        : Promise.resolve({ data: [] }),
      wantsFarm
        ? supabase.from("farm_field_data").select("*")
        : Promise.resolve({ data: [] }),
      wantsFarm
        ? supabase.from("farm_connections").select("id, label, scopes")
        : Promise.resolve({ data: [] }),
      wantsFarm
        ? supabase.from("farm_marketing_prices").select("*")
        : Promise.resolve({ data: [] }),
      wantsFarm
        ? supabase.from("farm_projected_yields").select("*")
        : Promise.resolve({ data: [] }),
    ]);
    setLands((l.data as LandLink[]) ?? []);
    setAssumptions((a.data as AssumptionRow[]) ?? []);
    setFarmMappings((fm.data as FieldMappingRow[]) ?? []);
    setFarmData((fd.data as FarmFieldDataRow[]) ?? []);
    setFarmConnections(
      (fc.data as Array<{ id: string; label: string; scopes: Record<string, boolean> | null }>) ??
        []
    );
    setMarketingPrices((mp.data as TenantPriceRow[]) ?? []);
    setProjectedYields((py.data as ProjectedYieldRow[]) ?? []);
  }, [supabase, lease.id, lease.lease_type, lease.rent_structure]);

  useEffect(() => {
    load();
  }, [load]);

  const tenant = tenants.find((t) => t.id === lease.tenant_id) ?? null;
  const propertyName = new Map(properties.map((p) => [p.id, p.name]));
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const totalAcres = lands.reduce((s, l) => s + (l.leased_acres ?? 0), 0);

  const insuranceWarning =
    lease.lease_type === "hunting"
      ? insuranceProblem(lease.terms?.insurance_required, tenant)
      : null;

  // Years of the lease term, for assumptions and projections
  const years = useMemo(() => {
    if (!lease.start_date || !lease.end_date) return [];
    const start = Number(lease.start_date.slice(0, 4));
    const end = Number(lease.end_date.slice(0, 4));
    if (!start || !end || end < start || end - start > 50) return [];
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [lease.start_date, lease.end_date]);

  const needsAssumptions =
    lease.lease_type === "agricultural" &&
    (lease.rent_structure === "flex" || lease.rent_structure === "crop_share");

  const assumptionsByYear = useMemo(
    () => new Map(assumptions.map((a) => [a.year, a.data ?? {}])),
    [assumptions]
  );

  const computeExpected = useCallback(
    () => generateLeasePayments(lease, totalAcres, assumptionsByYear),
    [lease, totalAcres, assumptionsByYear]
  );

  // Which farm connections and remote fields cover this lease's land
  // (shared by the actual-yield, tenant-price, and projected-yield
  // helpers).
  const relevantFarm = useMemo(() => {
    const keys = new Set<string>();
    const connectionIds = new Set<string>();
    const leasedFieldIds = new Set(lands.map((l) => l.field_id).filter(Boolean));
    const wholePropertyIds = new Set(
      lands.filter((l) => !l.field_id).map((l) => l.property_id)
    );
    for (const m of farmMappings) {
      const mappedField = m.local_field_id ? fieldById.get(m.local_field_id) : null;
      const onLease =
        (m.local_field_id && leasedFieldIds.has(m.local_field_id)) ||
        (mappedField && wholePropertyIds.has(mappedField.property_id)) ||
        (m.local_property_id && wholePropertyIds.has(m.local_property_id));
      if (onLease) {
        keys.add(`${m.farm_connection_id}|${m.remote_field_id}`);
        connectionIds.add(m.farm_connection_id);
      }
    }
    return { keys, connectionIds: Array.from(connectionIds) };
  }, [lands, farmMappings, fieldById]);

  const priceMethod: PriceMethod = lease.terms?.price_method ?? "manual";
  const priceScopedConnections = useMemo(
    () =>
      new Set(
        farmConnections
          .filter((c) => c.scopes?.projected_prices)
          .map((c) => c.id)
      ),
    [farmConnections]
  );
  const yieldScopedKeys = useMemo(() => {
    const scoped = new Set(
      farmConnections.filter((c) => c.scopes?.projected_yields).map((c) => c.id)
    );
    return new Set(
      Array.from(relevantFarm.keys).filter((k) => scoped.has(k.split("|")[0]))
    );
  }, [farmConnections, relevantFarm]);

  // Actual harvested yields from farm connections, per year, restricted to the
  // land this lease covers. Weighted average over the dominant crop's fields.
  const farmActualByYear = useMemo(() => {
    const result = new Map<number, FarmActual>();
    if (lands.length === 0 || farmMappings.length === 0 || farmData.length === 0) {
      return result;
    }
    const leasedFieldIds = new Set(lands.map((l) => l.field_id).filter(Boolean));
    const wholePropertyIds = new Set(
      lands.filter((l) => !l.field_id).map((l) => l.property_id)
    );
    const relevant = new Set<string>();
    for (const m of farmMappings) {
      const mappedField = m.local_field_id ? fieldById.get(m.local_field_id) : null;
      const onLease =
        (m.local_field_id && leasedFieldIds.has(m.local_field_id)) ||
        (mappedField && wholePropertyIds.has(mappedField.property_id)) ||
        (m.local_property_id && wholePropertyIds.has(m.local_property_id));
      if (onLease) relevant.add(`${m.farm_connection_id}|${m.remote_field_id}`);
    }
    const connectionLabel = new Map(farmConnections.map((c) => [c.id, c.label]));
    const byYear = new Map<number, FarmFieldDataRow[]>();
    for (const d of farmData) {
      if (!relevant.has(`${d.farm_connection_id}|${d.remote_field_id}`)) continue;
      if (d.production_units === null || !d.harvested_acres) continue;
      byYear.set(d.crop_year, [...(byYear.get(d.crop_year) ?? []), d]);
    }
    for (const [year, rows] of byYear) {
      // Pick the crop covering the most harvested acres, then average its yield
      const acresByCrop = new Map<string, number>();
      for (const r of rows) {
        const crop = r.crop || "Unknown";
        acresByCrop.set(crop, (acresByCrop.get(crop) ?? 0) + (r.harvested_acres ?? 0));
      }
      const topCrop = Array.from(acresByCrop.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!topCrop) continue;
      const cropRows = rows.filter((r) => (r.crop || "Unknown") === topCrop);
      const units = cropRows.reduce((s, r) => s + (r.production_units ?? 0), 0);
      const acres = cropRows.reduce((s, r) => s + (r.harvested_acres ?? 0), 0);
      if (!acres || !units) continue;
      result.set(year, {
        crop: topCrop,
        yieldPerAcre: Math.round((units / acres) * 10) / 10,
        unitLabel: yieldUnitLabel(cropRows[0].production_unit),
        source:
          connectionLabel.get(cropRows[0].farm_connection_id) ?? "your farm connection",
      });
    }
    return result;
  }, [lands, farmMappings, farmData, farmConnections, fieldById]);

  // ------------------------------------------------------------- land links

  async function addLand() {
    setError(null);
    const field = addFieldId ? fieldById.get(addFieldId) : null;
    const property = properties.find((p) => p.id === addPropertyId);
    const defaultAcres = field?.acres ?? property?.acres ?? 0;
    const { error: err } = await supabase.from("lease_lands").insert({
      organization_id: orgId,
      lease_id: lease.id,
      property_id: addPropertyId,
      field_id: addFieldId || null,
      leased_acres: Math.round(defaultAcres * 100) / 100,
    });
    if (err) {
      setError(
        err.message.includes("duplicate")
          ? "That land is already linked to this lease."
          : "Could not link: " + err.message
      );
      return;
    }
    setAddFieldId("");
    load();
  }

  async function updateLandAcres(id: string, acres: number) {
    await supabase.from("lease_lands").update({ leased_acres: acres }).eq("id", id);
    setLands((ls) => ls.map((l) => (l.id === id ? { ...l, leased_acres: acres } : l)));
  }

  async function removeLand(id: string) {
    await supabase.from("lease_lands").delete().eq("id", id);
    load();
  }

  // ------------------------------------------------------------- assumptions

  async function saveAssumption(year: number, data: YearAssumptions) {
    const existing = assumptions.find((a) => a.year === year);
    if (existing) {
      await supabase
        .from("lease_year_assumptions")
        .update({ data })
        .eq("id", existing.id);
    } else {
      await supabase.from("lease_year_assumptions").insert({
        organization_id: orgId,
        lease_id: lease.id,
        year,
        data,
      });
    }
    load();
  }

  // Save a confirmed custom pricing recipe into the lease terms.
  const [editingRecipe, setEditingRecipe] = useState(false);
  async function saveRecipe(recipe: PriceRecipe) {
    const terms = { ...(lease.terms ?? {}), custom_recipe: recipe };
    const { error: err } = await supabase
      .from("leases")
      .update({ terms })
      .eq("id", lease.id);
    if (err) {
      setError("Could not save the recipe: " + err.message);
      return;
    }
    setEditingRecipe(false);
    router.refresh();
  }

  async function setStatus(status: LeaseStatus) {
    await supabase.from("leases").update({ status }).eq("id", lease.id);
    router.refresh();
  }

  async function deleteLease() {
    if (!window.confirm("Delete this lease and all of its expected and recorded payments?")) return;
    await supabase.from("leases").delete().eq("id", lease.id);
    router.push("/leases");
  }

  const availableFields = fields.filter((f) => f.property_id === addPropertyId);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <Link href="/leases" className="text-sm text-gray-500 hover:underline">
          &larr; Leases
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{lease.name}</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium capitalize text-gray-600">
            {lease.lease_type}
          </span>
          <select
            value={lease.status}
            onChange={(e) => setStatus(e.target.value as LeaseStatus)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
          >
            {Object.entries(LEASE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {tenant ? (
            <Link
              href={`/tenants/${tenant.id}`}
              className="ml-auto text-sm font-medium text-kelly-700 hover:underline"
            >
              {tenant.name}
            </Link>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {lease.start_date} to {lease.end_date}
          {lease.auto_renew ? " · auto-renews" : ""}
          {lease.termination_notice_days
            ? ` · ${lease.termination_notice_days} day notice`
            : ""}
          {" · "}
          {formatAcres(totalAcres)} leased acres
        </p>
        {insuranceWarning ? (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {insuranceWarning}{" "}
            {tenant ? (
              <Link href={`/tenants/${tenant.id}`} className="font-medium underline">
                Update the tenant's insurance
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>

      <details
        open={editing}
        onToggle={(e) => setEditing((e.target as HTMLDetailsElement).open)}
        className="rounded-xl border border-gray-200 bg-white"
      >
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-kelly-700">
          Edit lease terms
        </summary>
        <div className="px-4 pb-4">
          <LeaseForm
            orgId={orgId}
            tenants={tenants}
            lease={lease}
          />
        </div>
      </details>

      {/* Linked land */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">
          Leased land{" "}
          <span className="text-sm font-normal text-gray-500">
            {formatAcres(totalAcres)} acres total
          </span>
        </h2>
        {lands.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No land linked yet. Link the properties (or specific fields) this
            lease covers; contract acres prefill from your mapped acres and can
            be edited to match the contract.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {lands.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"
              >
                <span className="font-medium text-gray-900">
                  {propertyName.get(l.property_id) ?? "Property"}
                </span>
                {l.field_id ? (
                  <span className="text-sm text-gray-500">
                    field: {fieldById.get(l.field_id)?.name ?? ""}
                  </span>
                ) : (
                  <span className="text-sm text-gray-500">whole property</span>
                )}
                <span className="ml-auto flex items-center gap-1 text-sm">
                  <input
                    type="number"
                    step="0.01"
                    value={l.leased_acres}
                    onChange={(e) => updateLandAcres(l.id, Number(e.target.value))}
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm"
                  />
                  <span className="text-gray-500">ac</span>
                </span>
                <button
                  onClick={() => removeLand(l.id)}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={addPropertyId}
            onChange={(e) => {
              setAddPropertyId(e.target.value);
              setAddFieldId("");
            }}
            className={inputClass}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={addFieldId}
            onChange={(e) => setAddFieldId(e.target.value)}
            className={inputClass}
          >
            <option value="">Whole property</option>
            {availableFields.map((f) => (
              <option key={f.id} value={f.id}>
                Field: {f.name} ({formatAcres(f.acres)} ac)
              </option>
            ))}
          </select>
          <button
            onClick={addLand}
            disabled={!addPropertyId}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            + Link land
          </button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </section>

      {/* Per-year assumptions for flex / crop share */}
      {needsAssumptions && years.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">
            Projection assumptions by year
          </h2>
          <p className="text-sm text-gray-500">
            {lease.rent_structure === "flex"
              ? `Base rent is computed from the base rate and leased acres; enter your estimated bonus per year. Bonus: ${lease.terms?.bonus_description ?? "not described"}`
              : "Crop share income is projected from these assumptions per year."}
          </p>
          {priceMethod === "custom" ? (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-gray-900">Pricing recipe</span>
                {lease.terms?.custom_recipe ? (
                  <span className="text-gray-600">
                    {lease.terms.custom_recipe.description}
                  </span>
                ) : (
                  <span className="text-amber-700">
                    Not set up yet; design it from the lease{"'"}s pricing clause.
                  </span>
                )}
                <button
                  onClick={() => setEditingRecipe((e) => !e)}
                  className="ml-auto text-sm font-medium text-kelly-700 hover:underline"
                >
                  {editingRecipe
                    ? "Close"
                    : lease.terms?.custom_recipe
                      ? "Edit recipe"
                      : "Set up recipe"}
                </button>
              </div>
              {editingRecipe ? (
                <div className="mt-2">
                  <RecipeEditor
                    initialClause={lease.terms?.pricing_clause ?? ""}
                    recipe={lease.terms?.custom_recipe ?? null}
                    onSave={saveRecipe}
                    onCancel={() => setEditingRecipe(false)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-2">
            {years.map((year) => {
              const a = assumptionsByYear.get(year) ?? {};
              const projected = annualRent(lease, totalAcres, a);
              return (
                <AssumptionRowEditor
                  key={year}
                  year={year}
                  structure={lease.rent_structure!}
                  value={a}
                  projected={projected}
                  farmActual={farmActualByYear.get(year) ?? null}
                  priceMethod={priceMethod}
                  tenantCard={tenantPriceCard(
                    relevantFarm.connectionIds,
                    priceScopedConnections,
                    marketingPrices,
                    year,
                    a.crop ?? null
                  )}
                  projectedYield={projectedYieldForYear(
                    projectedYields,
                    yieldScopedKeys,
                    year
                  )}
                  rmaConfig={rmaConfigForCrop(lease.terms?.rma_config, a.crop ?? null)}
                  recipe={lease.terms?.custom_recipe ?? null}
                  onSave={(data) => saveAssumption(year, data)}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <PaymentsSection
          orgId={orgId}
          leaseId={lease.id}
          computeExpected={computeExpected}
        />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Documents</h2>
        <EntityDocuments orgId={orgId} entityType="lease" entityId={lease.id} />
      </section>

      <section className="border-t border-gray-200 pt-4">
        <button
          onClick={deleteLease}
          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Delete lease
        </button>
      </section>
    </div>
  );
}

function AssumptionRowEditor({
  year,
  structure,
  value,
  projected,
  farmActual = null,
  priceMethod = "manual",
  tenantCard,
  projectedYield = null,
  rmaConfig = null,
  recipe = null,
  onSave,
}: {
  year: number;
  structure: "flex" | "crop_share" | "cash";
  value: YearAssumptions;
  projected: number | null;
  farmActual?: FarmActual | null;
  priceMethod?: PriceMethod;
  tenantCard: TenantPriceCard;
  projectedYield?: { crop: string; yieldPerAcre: number; unit: string | null } | null;
  rmaConfig?: RmaBenchmarkConfig | null;
  recipe?: PriceRecipe | null;
  onSave: (data: YearAssumptions) => void;
}) {
  const [data, setData] = useState<YearAssumptions>(value);
  const [dirty, setDirty] = useState(false);
  // Inputs filled by a helper stay amber until saved (or hand-edited).
  const [amberKeys, setAmberKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setData(value);
    setDirty(false);
    setAmberKeys(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);

  function set<K extends keyof YearAssumptions>(key: K, v: YearAssumptions[K]) {
    setData((d) => ({ ...d, [key]: v }));
    setDirty(true);
    setAmberKeys((keys) => {
      const next = new Set(keys);
      next.delete(key as string);
      return next;
    });
  }
  function fillFromHelper(patch: Partial<YearAssumptions>) {
    setData((d) => ({ ...d, ...patch }));
    setDirty(true);
    setAmberKeys((keys) => new Set([...keys, ...Object.keys(patch)]));
  }
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const amber = (key: string) =>
    amberKeys.has(key) ? " border-amber-400 bg-amber-50" : " border-gray-300";

  // The price helper card for this year, driven by the lease's method.
  // Crop share rows get a Use button targeting expected_price; flex rows
  // show the card as a reference beside the bonus estimate.
  const usePrice =
    structure === "crop_share"
      ? (price: number) => fillFromHelper({ expected_price: price })
      : undefined;
  const priceHelper =
    priceMethod === "tenant_average" ? (
      <TenantPriceCardView card={tenantCard} onUse={usePrice} />
    ) : priceMethod === "rma_benchmark" ? (
      rmaConfig ? (
        <RmaBenchmarkCard config={rmaConfig} year={year} onUse={usePrice} />
      ) : (
        <p className="text-xs text-gray-500">
          Add a crop benchmark (state and formula) in the lease terms first.
        </p>
      )
    ) : priceMethod === "custom" ? (
      recipe ? (
        <RecipeComputeCard
          recipe={recipe}
          year={year}
          crop={data.crop ?? null}
          rmaState={rmaConfig?.state ?? "AL"}
          tenantCard={tenantCard}
          onUse={usePrice}
        />
      ) : (
        <p className="text-xs text-gray-500">Set up the pricing recipe above first.</p>
      )
    ) : null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <span className="w-12 font-medium text-gray-900">{year}</span>
      {structure === "flex" ? (
        <>
          <label className="flex items-center gap-1 text-sm text-gray-600">
            Bonus estimate $
            <input
              type="number"
              step="0.01"
              value={data.bonus_estimate ?? ""}
              onChange={(e) => set("bonus_estimate", num(e.target.value))}
              className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          {priceHelper ? (
            <div className="w-full basis-full">{priceHelper}</div>
          ) : null}
        </>
      ) : (
        <>
          <input
            value={data.crop ?? ""}
            onChange={(e) => set("crop", e.target.value || null)}
            placeholder="Crop"
            className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            type="number"
            step="0.1"
            value={data.acres ?? ""}
            onChange={(e) => set("acres", num(e.target.value))}
            placeholder="Acres"
            className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            type="number"
            step="0.1"
            value={data.expected_yield ?? ""}
            onChange={(e) => set("expected_yield", num(e.target.value))}
            placeholder="Yield/ac"
            className={"w-20 rounded-lg border px-2 py-1 text-sm" + amber("expected_yield")}
          />
          <input
            type="number"
            step="0.01"
            value={data.expected_price ?? ""}
            onChange={(e) => set("expected_price", num(e.target.value))}
            placeholder="Price"
            className={"w-20 rounded-lg border px-2 py-1 text-sm" + amber("expected_price")}
          />
          <input
            type="number"
            step="0.01"
            value={data.expected_shared_expenses ?? ""}
            onChange={(e) => set("expected_shared_expenses", num(e.target.value))}
            placeholder="Shared exp $"
            className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm"
          />
          {farmActual && data.expected_yield !== farmActual.yieldPerAcre ? (
            <button
              onClick={() =>
                fillFromHelper({
                  crop: data.crop || farmActual.crop,
                  expected_yield: farmActual.yieldPerAcre,
                })
              }
              title={`Actual yield from ${farmActual.source}`}
              className="rounded-lg border border-kelly-500 px-2 py-1 text-xs font-medium text-kelly-700 hover:bg-kelly-50"
            >
              Use actual: {formatNumber(farmActual.yieldPerAcre)} {farmActual.unitLabel} (
              {farmActual.crop}, from farm data)
            </button>
          ) : null}
          {!farmActual &&
          projectedYield &&
          data.expected_yield !== projectedYield.yieldPerAcre ? (
            // Pre-harvest only; the post-harvest Use actual wins above.
            <button
              onClick={() =>
                fillFromHelper({
                  crop: data.crop || projectedYield.crop,
                  expected_yield: projectedYield.yieldPerAcre,
                })
              }
              title="Your tenant's projected yield for this land"
              className="rounded-lg border border-kelly-500 px-2 py-1 text-xs font-medium text-kelly-700 hover:bg-kelly-50"
            >
              Use tenant{"'"}s projected yield:{" "}
              {formatNumber(projectedYield.yieldPerAcre)} ({projectedYield.crop})
            </button>
          ) : null}
          {priceHelper ? (
            <div className="w-full basis-full">{priceHelper}</div>
          ) : null}
        </>
      )}
      <span className="ml-auto text-sm text-gray-500">
        {projected !== null ? `Projected: ${formatDollars(projected)}` : "Incomplete"}
      </span>
      {dirty ? (
        <button
          onClick={() => {
            onSave(data);
            setDirty(false);
          }}
          className="rounded-lg bg-kelly-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-kelly-600"
        >
          Save
        </button>
      ) : null}
    </div>
  );
}
