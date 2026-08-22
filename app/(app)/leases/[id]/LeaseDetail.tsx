"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars } from "@/lib/format";
import {
  CROP_PRACTICE_LABELS,
  LEASE_STATUS_LABELS,
  VALUE_SOURCE_LABELS,
  annualRent,
  cropAssumptions,
  generateLeasePayments,
  insuranceProblem,
  type CropAssumption,
  type LeaseStatus,
  type LeaseTerms,
  type LeaseType,
  type RentStructure,
  type SchedulePayment,
  type YearAssumptions,
  govPaymentTreatment,
  govTreatmentSentence,
} from "@/lib/leaseLogic";
import LeaseForm from "@/components/leases/LeaseForm";
import { govShareByYearForLease, loadIncomeInputs } from "@/lib/income";
import PaymentsSection from "@/components/payments/PaymentsSection";
import EntityDocuments from "@/components/documents/EntityDocuments";
import type { FarmFieldDataRow, FieldMappingRow } from "@/lib/farmDisplay";
import {
  rmaConfigForCrop,
  tenantPriceCard,
  type ProjectedYieldRow,
  type TenantPriceCard,
  type TenantPriceRow,
} from "@/lib/leasePricing";
import { matchCrop } from "@/lib/crops";
import { buildTenantCropRows, type TenantCropRow } from "@/lib/tenantData";
import TenantDataPanel, { type PanelFill } from "@/components/leases/TenantDataPanel";
import {
  RecipeComputeCard,
  RecipeEditor,
  RmaBenchmarkCard,
} from "@/components/leases/PriceMethodCards";
import type { PriceMethod, PriceRecipe, RmaBenchmarkConfig } from "@/lib/leaseLogic";

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
  tenants: Array<{
    id: string;
    name: string;
    insurance_on_file: boolean;
    insurance_expires: string | null;
    farm_connection_id?: string | null;
    farm_entity_id?: string | null;
    farm_entity_name?: string | null;
  }>;
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
    Array<{
      id: string;
      label: string;
      scopes: Record<string, boolean> | null;
      last_synced_at: string | null;
    }>
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
        ? supabase.from("farm_connections").select("id, label, scopes, last_synced_at")
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
      (fc.data as Array<{
        id: string;
        label: string;
        scopes: Record<string, boolean> | null;
        last_synced_at: string | null;
      }>) ?? []
    );
    setMarketingPrices((mp.data as TenantPriceRow[]) ?? []);
    setProjectedYields((py.data as ProjectedYieldRow[]) ?? []);
  }, [supabase, lease.id, lease.lease_type, lease.rent_structure]);

  useEffect(() => {
    load();
  }, [load]);

  const tenant = tenants.find((t) => t.id === lease.tenant_id) ?? null;
  // The lease tenant's farming entity: its prices win over the whole
  // operation's when the tenant is linked on the tenant page.
  const tenantEntity =
    tenant?.farm_connection_id && tenant.farm_entity_id
      ? { connectionId: tenant.farm_connection_id, entityId: tenant.farm_entity_id, entityName: tenant.farm_entity_name ?? null }
      : null;
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

  // Tenant-remitted government shares become expected rows (due each
  // October of the payment year); the amounts come from the same engine
  // the Income page uses, loaded on demand. FSA-direct shares never do.
  const govResolved = govPaymentTreatment(lease.terms);
  const wantsGovRows =
    govResolved.treatment === "landowner_share" && govResolved.receivedVia === "tenant_remits";
  const [govShareByYear, setGovShareByYear] = useState<Map<number, number> | null>(null);
  useEffect(() => {
    if (!wantsGovRows) {
      setGovShareByYear(null);
      return;
    }
    let cancelled = false;
    loadIncomeInputs(supabase)
      .then((inputs) => {
        if (!cancelled) setGovShareByYear(govShareByYearForLease(inputs, lease.id));
      })
      .catch(() => {
        if (!cancelled) setGovShareByYear(new Map());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsGovRows, lease.id, lease.terms]);

  const computeExpected = useCallback(
    () => generateLeasePayments(lease, totalAcres, assumptionsByYear, govShareByYear),
    [lease, totalAcres, assumptionsByYear, govShareByYear]
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
    const onLeaseMappings = farmMappings.filter((m) => {
      const mappedField = m.local_field_id ? fieldById.get(m.local_field_id) : null;
      return Boolean(
        (m.local_field_id && leasedFieldIds.has(m.local_field_id)) ||
          (mappedField && wholePropertyIds.has(mappedField.property_id)) ||
          (m.local_property_id && wholePropertyIds.has(m.local_property_id))
      );
    });
    // The tenant IS a farming entity: when linked, only that entity's
    // fields on the lease land count. Fall back to every mapping on the
    // land when none carries an entity (a pre-entity farm API).
    const entityScoped = tenantEntity
      ? onLeaseMappings.filter(
          (m) => m.farm_connection_id === tenantEntity.connectionId && m.remote_entity_id === tenantEntity.entityId
        )
      : [];
    const chosen = entityScoped.length > 0 ? entityScoped : onLeaseMappings;
    for (const m of chosen) {
      keys.add(`${m.farm_connection_id}|${m.remote_field_id}`);
      connectionIds.add(m.farm_connection_id);
    }
    return { keys, connectionIds: Array.from(connectionIds), scopedToEntity: entityScoped.length > 0 };
  }, [lands, farmMappings, fieldById, tenantEntity]);

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
  const yieldsScope = useMemo(
    () => new Set(farmConnections.filter((c) => c.scopes?.yields).map((c) => c.id)),
    [farmConnections]
  );
  const projectedYieldScope = useMemo(
    () =>
      new Set(
        farmConnections.filter((c) => c.scopes?.projected_yields).map((c) => c.id)
      ),
    [farmConnections]
  );

  // Last-saved crop entries per year (the overwrite guard compares
  // tenant values against these, never against unsaved edits).
  const savedEntriesByYear = useMemo(
    () =>
      new Map(years.map((y) => [y, cropAssumptions(assumptionsByYear.get(y))])),
    [years, assumptionsByYear]
  );

  // Tenant Data panel rows: per year, one row per crop the tenant
  // planted on this lease's mapped ground. Strictly crop-keyed.
  const tenantRowsByYear = useMemo(() => {
    const map = new Map<number, TenantCropRow[]>();
    if (relevantFarm.connectionIds.length === 0) return map;
    for (const year of years) {
      map.set(
        year,
        buildTenantCropRows({
          farmData,
          projectedYields,
          prices: marketingPrices,
          relevantKeys: relevantFarm.keys,
          relevantConnectionIds: relevantFarm.connectionIds,
          yieldsScope,
          projectedYieldScope,
          priceScope: priceScopedConnections,
          year,
          leaseCrops: (savedEntriesByYear.get(year) ?? []).map((e) => e.crop ?? null),
          tenantEntity,
        })
      );
    }
    return map;
  }, [
    years,
    relevantFarm,
    farmData,
    projectedYields,
    marketingPrices,
    yieldsScope,
    projectedYieldScope,
    priceScopedConnections,
    savedEntriesByYear,
  ]);

  // Panel Use actions push fills into the matching year's row editor;
  // values land amber for review there and save with the row as usual.
  const fillNonceRef = useRef(0);
  const [fillSignal, setFillSignal] = useState<{
    year: number;
    fills: PanelFill[];
    force: boolean;
    nonce: number;
  } | null>(null);
  function handlePanelFill(year: number, fills: PanelFill[], force: boolean) {
    fillNonceRef.current += 1;
    setFillSignal({ year, fills, force, nonce: fillNonceRef.current });
  }

  const [refreshingFarm, setRefreshingFarm] = useState(false);
  async function refreshFarm() {
    setRefreshingFarm(true);
    try {
      await Promise.all(
        relevantFarm.connectionIds.map((id) =>
          fetch("/api/farm/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connection_id: id }),
          })
        )
      );
    } finally {
      setRefreshingFarm(false);
      load();
    }
  }

  const relevantConnections = farmConnections.filter((c) =>
    relevantFarm.connectionIds.includes(c.id)
  );
  const farmLastSynced = relevantConnections
    .map((c) => c.last_synced_at)
    .filter(Boolean)
    .sort()
    .pop() ?? null;

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
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
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
        {lease.lease_type === "agricultural" &&
        (lease.rent_structure === "flex" || lease.rent_structure === "crop_share") ? (
          <p className="mt-2 text-sm text-gray-700">
            <span className="font-medium">Government payments:</span>{" "}
            {govTreatmentSentence(lease.terms)}
            {!govResolved.chosen || govResolved.needsReceivedVia ? (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="font-medium text-kelly-700 hover:underline"
                >
                  Choose in Edit lease terms
                </button>
              </>
            ) : null}
          </p>
        ) : null}
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
            No land linked yet. Link the properties (or specific ag fields) this
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
                    ag field: {fieldById.get(l.field_id)?.name ?? ""}
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
                Ag field: {f.name} ({formatAcres(f.acres)} ac)
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
          {relevantFarm.connectionIds.length > 0 ? (
            <TenantDataPanel
              yearBlocks={years.map((year) => ({
                year,
                rows: tenantRowsByYear.get(year) ?? [],
              }))}
              connectionLabel={
                relevantConnections.map((c) => c.label).join(", ") ||
                "your farm connection"
              }
              lastSyncedAt={farmLastSynced}
              scopeNote={
                tenantEntity && relevantFarm.scopedToEntity
                  ? `Tenant data for ${tenantEntity.entityName ?? tenant?.name ?? "this entity"} (from ${
                      relevantConnections.map((c) => c.label).join(", ") || "your farm connection"
                    })`
                  : null
              }
              canUse={lease.rent_structure === "crop_share"}
              savedEntriesByYear={savedEntriesByYear}
              onFill={handlePanelFill}
              onRefresh={refreshFarm}
              refreshing={refreshingFarm}
            />
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
                  priceMethod={priceMethod}
                  tenantCardFor={(crop) =>
                    tenantPriceCard(
                      relevantFarm.connectionIds,
                      priceScopedConnections,
                      marketingPrices,
                      year,
                      crop,
                      tenantEntity
                    )
                  }
                  rmaConfigFor={(crop) =>
                    rmaConfigForCrop(lease.terms?.rma_config, crop)
                  }
                  recipe={lease.terms?.custom_recipe ?? null}
                  fillSignal={
                    fillSignal && fillSignal.year === year ? fillSignal : null
                  }
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

const VALUE_FIELDS = ["acres", "expected_yield", "expected_price"] as const;
type ValueField = (typeof VALUE_FIELDS)[number];

function cloneEntry(e: CropAssumption): CropAssumption {
  return { ...e, sources: e.sources ? { ...e.sources } : undefined };
}

function entryHasContent(e: CropAssumption): boolean {
  return Boolean(
    e.crop ||
      e.acres != null ||
      e.expected_yield != null ||
      e.expected_price != null ||
      e.expected_shared_expenses != null
  );
}

// Subtle provenance line for tenant-filled values: which cells came from
// tenant data, projected vs final vs actual, and as of when.
function sourceTagLine(e: CropAssumption): string | null {
  const names: Record<ValueField, string> = {
    acres: "acres",
    expected_yield: "yield",
    expected_price: "price",
  };
  const parts: string[] = [];
  for (const field of VALUE_FIELDS) {
    const s = e.sources?.[field];
    if (s && e[field] != null) {
      parts.push(
        `${names[field]}: ${VALUE_SOURCE_LABELS[s.kind]}` +
          (s.as_of ? ` as of ${new Date(s.as_of).toLocaleDateString()}` : "")
      );
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function AssumptionRowEditor({
  year,
  structure,
  value,
  projected,
  priceMethod = "manual",
  tenantCardFor,
  rmaConfigFor,
  recipe = null,
  fillSignal = null,
  onSave,
}: {
  year: number;
  structure: "flex" | "crop_share" | "cash";
  value: YearAssumptions;
  projected: number | null;
  priceMethod?: PriceMethod;
  tenantCardFor: (crop: string | null) => TenantPriceCard;
  rmaConfigFor: (crop: string | null) => RmaBenchmarkConfig | null;
  recipe?: PriceRecipe | null;
  fillSignal?: { fills: PanelFill[]; force: boolean; nonce: number } | null;
  onSave: (data: YearAssumptions) => void;
}) {
  const [bonus, setBonus] = useState<number | null>(value.bonus_estimate ?? null);
  const [entries, setEntries] = useState<CropAssumption[]>(() => {
    const list = cropAssumptions(value).map(cloneEntry);
    return list.length > 0 ? list : [{}];
  });
  const [dirty, setDirty] = useState(false);
  // Inputs filled by a helper stay amber until saved (or hand-edited).
  // Keys are `${entryIndex}:${field}`.
  const [amberKeys, setAmberKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setBonus(value.bonus_estimate ?? null);
    const list = cropAssumptions(value).map(cloneEntry);
    setEntries(list.length > 0 ? list : [{}]);
    setDirty(false);
    setAmberKeys(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);

  // Apply fills pushed from the Tenant Data panel: find (or create) the
  // entry for each fill's crop, fill the values amber, and record their
  // provenance. Without force, a value the user already SAVED is never
  // replaced (the panel shows the saved-vs-tenant chip for those).
  const savedEntries = useMemo(
    () => cropAssumptions(value),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(value)]
  );
  useEffect(() => {
    if (!fillSignal) return;
    const next = entries.map(cloneEntry);
    const newAmber: string[] = [];
    for (const fill of fillSignal.fills) {
      const fillPractice = fill.practice ?? "blended";
      const practiceMatches = (e: CropAssumption) =>
        matchCrop(fill.crop, [e.crop]) !== null &&
        (e.practice ?? "blended") === fillPractice;
      let i = next.findIndex(practiceMatches);
      if (i === -1) i = next.findIndex((e) => !entryHasContent(e));
      if (i === -1) {
        next.push({});
        i = next.length - 1;
      }
      if (!next[i].crop) next[i] = { ...next[i], crop: fill.crop };
      if (fill.practice) next[i] = { ...next[i], practice: fill.practice };
      const savedMatch = savedEntries.find(practiceMatches) ?? null;
      for (const field of VALUE_FIELDS) {
        const v = fill.values[field];
        if (v === undefined || v === null) continue;
        const savedVal = savedMatch?.[field];
        if (!fillSignal.force && savedVal != null && savedVal !== v) continue;
        next[i] = {
          ...next[i],
          [field]: v,
          sources: { ...(next[i].sources ?? {}), [field]: fill.sources[field] ?? null },
        };
        newAmber.push(`${i}:${field}`);
      }
    }
    if (newAmber.length > 0) {
      setEntries(next);
      setAmberKeys((keys) => new Set([...keys, ...newAmber]));
      setDirty(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillSignal?.nonce]);

  function setEntry(i: number, field: keyof CropAssumption, v: unknown) {
    setEntries((es) =>
      es.map((e, j) => {
        if (j !== i) return e;
        const next = { ...e, [field]: v } as CropAssumption;
        // A hand edit keeps the edit and drops the tenant provenance.
        if (field !== "crop" && next.sources) {
          next.sources = { ...next.sources, [field as ValueField]: null };
        }
        return next;
      })
    );
    setDirty(true);
    setAmberKeys((keys) => {
      const next = new Set(keys);
      next.delete(`${i}:${String(field)}`);
      return next;
    });
  }

  function fillPrice(i: number, price: number) {
    setEntries((es) =>
      es.map((e, j) =>
        j === i
          ? {
              ...e,
              expected_price: price,
              sources: { ...(e.sources ?? {}), expected_price: null },
            }
          : e
      )
    );
    setDirty(true);
    setAmberKeys((keys) => new Set([...keys, `${i}:expected_price`]));
  }

  function save() {
    if (structure === "flex") {
      onSave({ bonus_estimate: bonus });
    } else {
      const crops = entries.filter(entryHasContent).map((e) => {
        const sources: NonNullable<CropAssumption["sources"]> = {};
        for (const field of VALUE_FIELDS) {
          const s = e.sources?.[field];
          if (s && e[field] != null) sources[field] = s;
        }
        return {
          crop: e.crop ?? null,
          practice: e.practice ?? null,
          acres: e.acres ?? null,
          expected_yield: e.expected_yield ?? null,
          expected_price: e.expected_price ?? null,
          expected_shared_expenses: e.expected_shared_expenses ?? null,
          ...(Object.keys(sources).length > 0 ? { sources } : {}),
        };
      });
      onSave({ crops });
    }
    setDirty(false);
  }

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const amber = (key: string) =>
    amberKeys.has(key) ? " border-amber-400 bg-amber-50" : " border-gray-300";

  // Price helper per crop entry, driven by the lease's method. The
  // tenant_average method is served by the Tenant Data panel above, so
  // rows carry no card for it.
  const helperFor = (i: number) => {
    const e = entries[i];
    const usePrice =
      structure === "crop_share" ? (price: number) => fillPrice(i, price) : undefined;
    if (priceMethod === "rma_benchmark") {
      const config = rmaConfigFor(e.crop ?? null);
      return config ? (
        <RmaBenchmarkCard config={config} year={year} onUse={usePrice} />
      ) : (
        <p className="text-xs text-gray-500">
          {e.crop
            ? `Add a ${e.crop} benchmark (state and formula) in the lease terms first.`
            : "Add a crop benchmark (state and formula) in the lease terms first."}
        </p>
      );
    }
    if (priceMethod === "custom") {
      return recipe ? (
        <RecipeComputeCard
          recipe={recipe}
          year={year}
          crop={e.crop ?? null}
          rmaState={rmaConfigFor(e.crop ?? null)?.state ?? "AL"}
          tenantCard={tenantCardFor(e.crop ?? null)}
          onUse={usePrice}
        />
      ) : (
        <p className="text-xs text-gray-500">Set up the pricing recipe above first.</p>
      );
    }
    return null;
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      {structure === "flex" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 font-medium text-gray-900">{year}</span>
          <label className="flex items-center gap-1 text-sm text-gray-600">
            Bonus estimate $
            <input
              type="number"
              step="0.01"
              value={bonus ?? ""}
              onChange={(e) => {
                setBonus(num(e.target.value));
                setDirty(true);
              }}
              className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          {helperFor(0) ? <div className="w-full basis-full">{helperFor(0)}</div> : null}
          <span className="ml-auto text-sm text-gray-500">
            {projected !== null ? `Projected: ${formatDollars(projected)}` : "Incomplete"}
          </span>
          {dirty ? (
            <button
              onClick={save}
              className="rounded-lg bg-kelly-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-kelly-600"
            >
              Save
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e, i) => {
            const tagLine = sourceTagLine(e);
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-12 font-medium text-gray-900">
                  {i === 0 ? year : ""}
                </span>
                <input
                  value={e.crop ?? ""}
                  onChange={(ev) => setEntry(i, "crop", ev.target.value || null)}
                  placeholder="Crop"
                  className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                />
                <select
                  value={e.practice ?? "blended"}
                  onChange={(ev) =>
                    setEntry(
                      i,
                      "practice",
                      ev.target.value === "blended" ? null : ev.target.value
                    )
                  }
                  title="Irrigated vs dryland practice; blended is one set of numbers for the whole crop"
                  className="rounded-lg border border-gray-300 px-1.5 py-1 text-xs text-gray-700"
                >
                  {Object.entries(CROP_PRACTICE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.1"
                  value={e.acres ?? ""}
                  onChange={(ev) => setEntry(i, "acres", num(ev.target.value))}
                  placeholder="Acres"
                  className={"w-20 rounded-lg border px-2 py-1 text-sm" + amber(`${i}:acres`)}
                />
                <input
                  type="number"
                  step="0.1"
                  value={e.expected_yield ?? ""}
                  onChange={(ev) => setEntry(i, "expected_yield", num(ev.target.value))}
                  placeholder="Yield/ac"
                  className={
                    "w-20 rounded-lg border px-2 py-1 text-sm" + amber(`${i}:expected_yield`)
                  }
                />
                <input
                  type="number"
                  step="0.01"
                  value={e.expected_price ?? ""}
                  onChange={(ev) => setEntry(i, "expected_price", num(ev.target.value))}
                  placeholder="Price"
                  className={
                    "w-20 rounded-lg border px-2 py-1 text-sm" + amber(`${i}:expected_price`)
                  }
                />
                <input
                  type="number"
                  step="0.01"
                  value={e.expected_shared_expenses ?? ""}
                  onChange={(ev) =>
                    setEntry(i, "expected_shared_expenses", num(ev.target.value))
                  }
                  placeholder="Shared exp $"
                  className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                />
                {entries.length > 1 || entryHasContent(e) ? (
                  <button
                    onClick={() => {
                      setEntries((es) =>
                        es.length > 1 ? es.filter((_, j) => j !== i) : [{}]
                      );
                      setDirty(true);
                      setAmberKeys(new Set());
                    }}
                    className="text-xs font-medium text-red-600 hover:underline"
                    title="Remove this crop from the year"
                  >
                    Remove
                  </button>
                ) : null}
                {tagLine ? (
                  <span className="w-full basis-full pl-14 text-[11px] text-gray-500">
                    {tagLine}
                  </span>
                ) : null}
                {helperFor(i) ? (
                  <div className="w-full basis-full pl-14">{helperFor(i)}</div>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 pl-14">
            <button
              onClick={() => {
                setEntries((es) => [...es, {}]);
                setDirty(true);
              }}
              className="text-xs font-medium text-kelly-700 hover:underline"
            >
              + Add crop
            </button>
            <span className="ml-auto text-sm text-gray-500">
              {projected !== null
                ? `Projected: ${formatDollars(projected)}`
                : "Incomplete"}
            </span>
            {dirty ? (
              <button
                onClick={save}
                className="rounded-lg bg-kelly-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-kelly-600"
              >
                Save
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
