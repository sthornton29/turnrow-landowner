"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatAcres, formatDollars } from "@/lib/format";
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

  const load = useCallback(async () => {
    const [l, a] = await Promise.all([
      supabase.from("lease_lands").select("*").eq("lease_id", lease.id),
      supabase.from("lease_year_assumptions").select("*").eq("lease_id", lease.id).order("year"),
    ]);
    setLands((l.data as LandLink[]) ?? []);
    setAssumptions((a.data as AssumptionRow[]) ?? []);
  }, [supabase, lease.id]);

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
  onSave,
}: {
  year: number;
  structure: "flex" | "crop_share" | "cash";
  value: YearAssumptions;
  projected: number | null;
  onSave: (data: YearAssumptions) => void;
}) {
  const [data, setData] = useState<YearAssumptions>(value);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setData(value);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);

  function set<K extends keyof YearAssumptions>(key: K, v: YearAssumptions[K]) {
    setData((d) => ({ ...d, [key]: v }));
    setDirty(true);
  }
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <span className="w-12 font-medium text-gray-900">{year}</span>
      {structure === "flex" ? (
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
            className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            type="number"
            step="0.01"
            value={data.expected_price ?? ""}
            onChange={(e) => set("expected_price", num(e.target.value))}
            placeholder="Price"
            className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            type="number"
            step="0.01"
            value={data.expected_shared_expenses ?? ""}
            onChange={(e) => set("expected_shared_expenses", num(e.target.value))}
            placeholder="Shared exp $"
            className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm"
          />
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
