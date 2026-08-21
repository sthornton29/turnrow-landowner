"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LEASE_STATUS_LABELS,
  PRICE_METHOD_LABELS,
  type LeaseStatus,
  type LeaseTerms,
  type LeaseType,
  type PriceMethod,
  type RentStructure,
  type SchedulePayment,
  GOV_RECEIVED_VIA_LABELS,
  GOV_TREATMENT_LABELS,
  govPaymentTreatment,
  type GovPaymentReceivedVia,
  type GovPaymentTreatment
} from "@/lib/leaseLogic";
import {
  matchLeaseLand,
  type ExtractedLeaseLand,
  type MatchableParcel,
  type MatchableProperty,
} from "@/lib/leaseLand";

export interface LeasePrefill {
  lease_type?: LeaseType | null;
  tenant_name?: string | null;
  name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  auto_renew?: boolean | null;
  termination_notice_days?: number | null;
  rent_structure?: RentStructure | null;
  terms?: LeaseTerms | null;
  payment_schedule?: SchedulePayment[] | null;
  special_provisions?: string | null;
  leased_properties?: ExtractedLeaseLand[] | null;
  leased_acres_total?: number | null;
  price_method?: PriceMethod | null;
  pricing_clause?: string | null;
  gov_payment_clause?: string | null;
  gov_payment_treatment?: GovPaymentTreatment | null;
  gov_payment_share_pct?: number | null;
  gov_payment_received_via?: GovPaymentReceivedVia | null;
}

// One row of the Leased land section: a lease can cover several
// properties, and a property can appear in several leases.
interface LandRow {
  propertyId: string;
  acres: string;
  sourceText: string | null; // how the document described this land
  aiDerived: boolean; // amber until the user touches the row
}

interface ExistingLease {
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

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function LeaseForm({
  orgId,
  tenants,
  lease,
  prefill,
  unsure = [],
  sourceFile,
  properties = [],
  parcels = [],
}: {
  orgId: string;
  tenants: Array<{ id: string; name: string }>;
  lease?: ExistingLease | null;
  prefill?: LeasePrefill | null;
  unsure?: string[];
  sourceFile?: File | null;
  // For the Leased land section on NEW leases (the lease page manages
  // land after creation).
  properties?: MatchableProperty[];
  parcels?: MatchableParcel[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  // Tenant: preselect a fuzzy match on the extracted name, else offer create.
  const matchedTenant = useMemo(() => {
    const name = prefill?.tenant_name?.toLowerCase().trim();
    if (!name) return null;
    return (
      tenants.find((t) => t.name.toLowerCase() === name) ??
      tenants.find(
        (t) => t.name.toLowerCase().includes(name) || name.includes(t.name.toLowerCase())
      ) ??
      null
    );
  }, [prefill, tenants]);

  const [tenantId, setTenantId] = useState<string>(
    lease?.tenant_id ?? matchedTenant?.id ?? (prefill?.tenant_name ? "__new__" : tenants[0]?.id ?? "__new__")
  );
  const [newTenantName, setNewTenantName] = useState(prefill?.tenant_name ?? "");
  const [leaseType, setLeaseType] = useState<LeaseType>(
    lease?.lease_type ?? prefill?.lease_type ?? "agricultural"
  );
  const [name, setName] = useState(lease?.name ?? prefill?.name ?? "");
  const [status, setStatus] = useState<LeaseStatus>(lease?.status ?? "draft");
  const [startDate, setStartDate] = useState(lease?.start_date ?? prefill?.start_date ?? "");
  const [endDate, setEndDate] = useState(lease?.end_date ?? prefill?.end_date ?? "");
  const [autoRenew, setAutoRenew] = useState(lease?.auto_renew ?? prefill?.auto_renew ?? false);
  const [noticeDays, setNoticeDays] = useState<string>(
    String(lease?.termination_notice_days ?? prefill?.termination_notice_days ?? "")
  );
  const [rentStructure, setRentStructure] = useState<RentStructure>(
    lease?.rent_structure ?? prefill?.rent_structure ?? "cash"
  );
  const [terms, setTerms] = useState<LeaseTerms>(() => ({
    ...(lease?.terms ?? prefill?.terms ?? {}),
    // The extraction reports the price method and pricing clause at the
    // top level; fold them into terms where they live.
    ...(!lease && prefill?.price_method ? { price_method: prefill.price_method } : {}),
    ...(!lease && prefill?.pricing_clause ? { pricing_clause: prefill.pricing_clause } : {}),
    ...(!lease && prefill?.gov_payment_clause ? { gov_payment_clause: prefill.gov_payment_clause } : {}),
    ...(!lease && prefill?.gov_payment_treatment ? { gov_payment_treatment: prefill.gov_payment_treatment } : {}),
    ...(!lease && prefill?.gov_payment_share_pct != null ? { gov_payment_share_pct: prefill.gov_payment_share_pct } : {}),
    ...(!lease && prefill?.gov_payment_received_via ? { gov_payment_received_via: prefill.gov_payment_received_via } : {}),
    // Existing leases saved before the explicit choice: preselect the
    // migration default and say so (saved only when the user saves).
    ...(lease && !lease.terms?.gov_payment_treatment
      ? { gov_payment_treatment: govPaymentTreatment(lease.terms).treatment }
      : {}),
  }));
  const [govMigrated, setGovMigrated] = useState<boolean>(
    !!lease && !lease.terms?.gov_payment_treatment &&
      (lease.rent_structure === "flex" || lease.rent_structure === "crop_share")
  );
  const [schedule, setSchedule] = useState<SchedulePayment[]>(
    lease?.payment_schedule?.length
      ? lease.payment_schedule
      : prefill?.payment_schedule?.length
        ? prefill.payment_schedule
        : []
  );
  const [provisions, setProvisions] = useState(
    lease?.special_provisions ?? prefill?.special_provisions ?? ""
  );
  // Leased land: extracted tract descriptions matched against existing
  // properties (FSA and parcel numbers are strong evidence; names,
  // county, and acreage supporting). Suggestions only; every link is
  // confirmed here before saving.
  const [land, setLand] = useState<LandRow[]>(() => {
    if (lease) return [];
    const extracted = prefill?.leased_properties ?? [];
    return extracted.map((item): LandRow => {
      const match = matchLeaseLand(item, properties, parcels);
      const matched = match.propertyId
        ? properties.find((p) => p.id === match.propertyId)
        : null;
      return {
        propertyId: match.propertyId ?? "",
        acres:
          item.acres !== null
            ? String(item.acres)
            : matched?.acres != null
              ? String(Math.round(matched.acres * 10) / 10)
              : "",
        sourceText: item.description || null,
        aiDerived: true,
      };
    });
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLand(i: number, patch: Partial<LandRow>) {
    setLand((rows) =>
      rows.map((row, j) =>
        j === i ? { ...row, ...patch, aiDerived: false } : row
      )
    );
  }

  const isUnsure = (key: string) =>
    unsure.includes(key) || unsure.includes(`terms.${key}`);
  const ring = (key: string) =>
    isUnsure(key) ? " border-amber-400 ring-2 ring-amber-100" : "";

  function setTerm<K extends keyof LeaseTerms>(key: K, value: LeaseTerms[K]) {
    setTerms((t) => ({ ...t, [key]: value }));
  }

  function num(v: string): number | null {
    return v.trim() === "" ? null : Number(v);
  }

  function updateSchedule(i: number, patch: Partial<SchedulePayment>) {
    setSchedule((s) => s.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    if (
      leaseType === "agricultural" &&
      (rentStructure === "flex" || rentStructure === "crop_share")
    ) {
      if (!terms.gov_payment_treatment) {
        setError("Choose how government payments are treated (landowner share or tenant retains all).");
        setBusy(false);
        return;
      }
      if (terms.gov_payment_treatment === "landowner_share" && !terms.gov_payment_received_via) {
        setError("Choose how your government payment share is received (FSA directly or tenant remits).");
        setBusy(false);
        return;
      }
    }

    let finalTenantId = tenantId;
    if (tenantId === "__new__") {
      if (!newTenantName.trim()) {
        setError("Enter the new tenant's name.");
        setBusy(false);
        return;
      }
      const { data, error: err } = await supabase
        .from("tenants")
        .insert({ organization_id: orgId, name: newTenantName.trim() })
        .select("id")
        .single();
      if (err || !data) {
        setError("Could not create the tenant: " + (err?.message ?? ""));
        setBusy(false);
        return;
      }
      finalTenantId = data.id;
    }

    const row = {
      organization_id: orgId,
      tenant_id: finalTenantId,
      lease_type: leaseType,
      name: name.trim() || "Untitled lease",
      status,
      start_date: startDate || null,
      end_date: endDate || null,
      auto_renew: autoRenew,
      termination_notice_days: num(noticeDays),
      rent_structure: leaseType === "agricultural" ? rentStructure : null,
      terms,
      payment_schedule: schedule,
      special_provisions: provisions.trim() || null,
    };

    if (lease) {
      const { error: err } = await supabase.from("leases").update(row).eq("id", lease.id);
      setBusy(false);
      if (err) {
        setError("Could not save: " + err.message);
        return;
      }
      router.refresh();
      return;
    }

    const { data, error: err } = await supabase
      .from("leases")
      .insert(row)
      .select("id")
      .single();
    if (err || !data) {
      setError("Could not save: " + (err?.message ?? ""));
      setBusy(false);
      return;
    }

    // Link the confirmed leased land (a lease can cover several
    // properties). Rows with no property picked are simply not linked;
    // the lease page can link land any time. Best effort: the lease
    // exists either way, so failures here never strand the user on a
    // form that would double-create on retry.
    const landInserts = land
      .filter((r) => r.propertyId)
      .map((r) => ({
        organization_id: orgId,
        lease_id: data.id,
        property_id: r.propertyId,
        leased_acres: r.acres.trim() === "" ? null : Number(r.acres),
      }));
    if (landInserts.length > 0) {
      await supabase.from("lease_lands").insert(landInserts);
    }

    // Attach the source document the terms were extracted from.
    if (sourceFile) {
      const path = `${orgId}/lease/${crypto.randomUUID()}-${sourceFile.name}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, sourceFile, { contentType: sourceFile.type });
      if (!upErr) {
        await supabase.from("documents").insert({
          organization_id: orgId,
          entity_type: "lease",
          entity_id: data.id,
          file_name: sourceFile.name,
          storage_path: path,
          content_type: sourceFile.type,
          size_bytes: sourceFile.size,
        });
      }
    }
    router.push(`/leases/${data.id}`);
  }

  return (
    <div className="space-y-4">
      {unsure.length > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Fields highlighted in amber are ones the AI was not confident about.
          Check them against the document before saving.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Lease type</label>
          <select
            value={leaseType}
            onChange={(e) => setLeaseType(e.target.value as LeaseType)}
            className={inputClass + ring("lease_type")}
          >
            <option value="agricultural">Agricultural</option>
            <option value="hunting">Hunting</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Name / label</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Smith farm lease"
            className={inputClass + ring("name")}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Tenant</label>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className={inputClass + ring("tenant_name")}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {matchedTenant?.id === t.id && prefill?.tenant_name ? " (suggested match)" : ""}
              </option>
            ))}
            <option value="__new__">+ New tenant...</option>
          </select>
          {tenantId === "__new__" ? (
            <input
              value={newTenantName}
              onChange={(e) => setNewTenantName(e.target.value)}
              placeholder="New tenant name"
              className={`${inputClass} mt-2` + ring("tenant_name")}
            />
          ) : null}
          {prefill?.tenant_name && !matchedTenant ? (
            <p className="mt-1 text-xs text-gray-500">
              Document names the tenant as {'"'}
              {prefill.tenant_name}
              {'"'}; no existing tenant matched, so a new one will be created.
            </p>
          ) : null}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as LeaseStatus)}
            className={inputClass}
          >
            {Object.entries(LEASE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass + ring("start_date")}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">End date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass + ring("end_date")}
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
              className="h-4 w-4 accent-kelly-500"
            />
            Auto-renews
          </label>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Termination notice (days)
          </label>
          <input
            type="number"
            value={noticeDays}
            onChange={(e) => setNoticeDays(e.target.value)}
            className={inputClass + ring("termination_notice_days")}
          />
        </div>
      </div>

      {/* Rent terms */}
      {leaseType === "agricultural" ? (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["cash", "Cash"],
                ["flex", "Flex"],
                ["crop_share", "Crop share"],
              ] as Array<[RentStructure, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setRentStructure(value)}
                className={
                  "rounded-lg border px-2 py-1.5 text-sm font-medium " +
                  (rentStructure === value
                    ? "border-kelly-500 bg-kelly-50 text-pine-900"
                    : "border-gray-300 bg-white text-gray-600") +
                  ring("rent_structure")
                }
              >
                {label}
              </button>
            ))}
          </div>

          {rentStructure === "cash" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Basis</label>
                <select
                  value={terms.cash_basis ?? "per_acre"}
                  onChange={(e) => setTerm("cash_basis", e.target.value as "per_acre" | "lump_sum")}
                  className={inputClass + ring("cash_basis")}
                >
                  <option value="per_acre">Rate per acre</option>
                  <option value="lump_sum">Lump sum per year</option>
                </select>
              </div>
              {(terms.cash_basis ?? "per_acre") === "per_acre" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Rate ($ / acre / year)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={terms.rate_per_acre ?? ""}
                    onChange={(e) => setTerm("rate_per_acre", num(e.target.value))}
                    className={inputClass + ring("rate_per_acre")}
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Lump sum ($ / year)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={terms.lump_sum ?? ""}
                    onChange={(e) => setTerm("lump_sum", num(e.target.value))}
                    className={inputClass + ring("lump_sum")}
                  />
                </div>
              )}
            </div>
          ) : null}

          {rentStructure === "flex" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Base rate ($ / acre / year)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={terms.base_rate_per_acre ?? ""}
                  onChange={(e) => setTerm("base_rate_per_acre", num(e.target.value))}
                  className={inputClass + ring("base_rate_per_acre")}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Bonus formula (in words)
                </label>
                <input
                  value={terms.bonus_description ?? ""}
                  onChange={(e) => setTerm("bonus_description", e.target.value || null)}
                  placeholder="e.g. 30% of gross revenue above $700/acre"
                  className={inputClass + ring("bonus_description")}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Projections use a bonus estimate you enter per year on the lease page.
                </p>
              </div>
            </div>
          ) : null}

          {rentStructure === "crop_share" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Landowner share (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={terms.landowner_share_pct ?? ""}
                  onChange={(e) => setTerm("landowner_share_pct", num(e.target.value))}
                  className={inputClass + ring("landowner_share_pct")}
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={terms.shares_expenses ?? false}
                    onChange={(e) => setTerm("shares_expenses", e.target.checked)}
                    className="h-4 w-4 accent-kelly-500"
                  />
                  Landowner shares expenses
                </label>
              </div>
              {terms.shares_expenses ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Expense share (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={terms.expense_share_pct ?? ""}
                    onChange={(e) => setTerm("expense_share_pct", num(e.target.value))}
                    className={inputClass + ring("expense_share_pct")}
                  />
            </div>
              ) : null}
              <p className="text-xs text-gray-500 sm:col-span-3">
                Projections use per-year assumptions (crop, acres, yield, price, shared
                expenses) you enter on the lease page.
              </p>
            </div>
          ) : null}

          {/* Government payments (ARC/PLC on the leased base acres): an
              explicit choice, never a defaulted percentage. */}
          {rentStructure === "flex" || rentStructure === "crop_share" ? (
            <div className="space-y-2 border-t border-gray-200 pt-2">
              <p className="text-sm font-medium text-gray-700">
                Government payments (ARC/PLC) <span className="text-red-600">*</span>
              </p>
              {govMigrated ? (
                <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  This lease was saved before this choice existed; the selection below is a best guess from its old share percent. Confirm it and save.
                </p>
              ) : null}
              <div className={"space-y-1.5 rounded-lg border p-2.5" + (isUnsure("gov_payment_treatment") ? " border-amber-400 ring-2 ring-amber-100" : " border-gray-200")}>
                {(Object.keys(GOV_TREATMENT_LABELS) as GovPaymentTreatment[]).map((opt) => (
                  <label key={opt} className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
                    <input
                      type="radio"
                      name="gov_payment_treatment"
                      checked={terms.gov_payment_treatment === opt}
                      onChange={() => {
                        setTerms((t) => ({
                          ...t,
                          gov_payment_treatment: opt,
                          // Landowner share prefills from the crop share percent.
                          gov_payment_share_pct:
                            opt === "landowner_share"
                              ? (t.gov_payment_share_pct ?? (rentStructure === "crop_share" ? (t.landowner_share_pct ?? null) : null))
                              : null,
                          gov_payment_received_via: opt === "landowner_share" ? (t.gov_payment_received_via ?? null) : null,
                        }));
                        setGovMigrated(false);
                      }}
                      className="mt-0.5 accent-kelly-500"
                    />
                    <span>{GOV_TREATMENT_LABELS[opt]}</span>
                  </label>
                ))}
              </div>
              {terms.gov_payment_treatment === "landowner_share" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Your share (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={100}
                      value={terms.gov_payment_share_pct ?? ""}
                      onChange={(e) => setTerm("gov_payment_share_pct", num(e.target.value))}
                      className={inputClass + ring("gov_payment_share_pct")}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Prefilled from the crop share percent; edit if the lease says otherwise.
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 block text-sm font-medium text-gray-700">Received via</p>
                    <div className={"space-y-1.5 rounded-lg border p-2.5" + (isUnsure("gov_payment_received_via") ? " border-amber-400 ring-2 ring-amber-100" : " border-gray-200")}>
                      {(Object.keys(GOV_RECEIVED_VIA_LABELS) as GovPaymentReceivedVia[]).map((opt) => (
                        <label key={opt} className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
                          <input
                            type="radio"
                            name="gov_payment_received_via"
                            checked={terms.gov_payment_received_via === opt}
                            onChange={() => setTerm("gov_payment_received_via", opt)}
                            className="mt-0.5 accent-kelly-500"
                          />
                          <span>{GOV_RECEIVED_VIA_LABELS[opt]}</span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      FSA-direct money is never expected in a tenant check; a tenant-remitted share becomes an expected payment due each October.
                    </p>
                  </div>
                </div>
              ) : null}
              {terms.gov_payment_clause ? (
                <p className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">
                  From the lease: {terms.gov_payment_clause}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Price method: where each year's suggested average price
              comes from. Assumptions work exactly as before; every
              suggestion is reviewed before saving. */}
          {rentStructure === "flex" || rentStructure === "crop_share" ? (
            <div className="space-y-2 border-t border-gray-200 pt-2">
              <label className="block text-sm font-medium text-gray-700">
                Price method
              </label>
              <select
                value={terms.price_method ?? "manual"}
                onChange={(e) => setTerm("price_method", e.target.value as PriceMethod)}
                className={inputClass + ring("price_method")}
              >
                {Object.entries(PRICE_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {(terms.price_method ?? "manual") === "rma_benchmark" ? (
                <div className="space-y-1.5">
                  {(terms.rma_config ?? []).map((row, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-1.5">
                      <input
                        value={row.crop}
                        onChange={(e) =>
                          setTerm(
                            "rma_config",
                            (terms.rma_config ?? []).map((r, j) =>
                              j === i ? { ...r, crop: e.target.value } : r
                            )
                          )
                        }
                        placeholder="Crop"
                        className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                      <input
                        value={row.state}
                        onChange={(e) =>
                          setTerm(
                            "rma_config",
                            (terms.rma_config ?? []).map((r, j) =>
                              j === i ? { ...r, state: e.target.value.toUpperCase() } : r
                            )
                          )
                        }
                        placeholder="State"
                        maxLength={2}
                        className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm uppercase"
                      />
                      <select
                        value={row.formula}
                        onChange={(e) =>
                          setTerm(
                            "rma_config",
                            (terms.rma_config ?? []).map((r, j) =>
                              j === i
                                ? { ...r, formula: e.target.value as typeof row.formula }
                                : r
                            )
                          )
                        }
                        className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="average">Average of projected and harvest</option>
                        <option value="projected">Projected price only</option>
                        <option value="harvest">Harvest price only</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setTerm(
                            "rma_config",
                            (terms.rma_config ?? []).filter((_, j) => j !== i)
                          )
                        }
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setTerm("rma_config", [
                        ...(terms.rma_config ?? []),
                        {
                          crop: "Corn",
                          state:
                            properties.find((p) => p.state)?.state?.toUpperCase() ?? "AL",
                          formula: "average" as const,
                        },
                      ])
                    }
                    className="text-sm font-medium text-kelly-700 hover:underline"
                  >
                    + Add crop benchmark
                  </button>
                  <p className="text-xs text-gray-500">
                    RMA covers corn, soybeans, wheat, cotton, and canola.
                    Windows and prices are per state.
                  </p>
                </div>
              ) : null}
              {(terms.price_method ?? "manual") === "custom" ? (
                <p className="text-xs text-gray-500">
                  {terms.custom_recipe
                    ? `Recipe saved: ${terms.custom_recipe.description}`
                    : "Set up the pricing recipe on the lease page after saving."}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Basis</label>
            <select
              value={terms.hunt_basis ?? "lump_sum"}
              onChange={(e) => setTerm("hunt_basis", e.target.value as "lump_sum" | "per_acre")}
              className={inputClass + ring("hunt_basis")}
            >
              <option value="lump_sum">Annual lump sum</option>
              <option value="per_acre">Rate per acre</option>
            </select>
          </div>
          {(terms.hunt_basis ?? "lump_sum") === "lump_sum" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Annual amount ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={terms.amount ?? ""}
                onChange={(e) => setTerm("amount", num(e.target.value))}
                className={inputClass + ring("amount")}
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Rate ($ / acre / year)
              </label>
              <input
                type="number"
                step="0.01"
                value={terms.hunt_rate_per_acre ?? ""}
                onChange={(e) => setTerm("hunt_rate_per_acre", num(e.target.value))}
                className={inputClass + ring("hunt_rate_per_acre")}
              />
            </div>
          )}
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={terms.insurance_required ?? false}
                onChange={(e) => setTerm("insurance_required", e.target.checked)}
                className="h-4 w-4 accent-kelly-500"
              />
              Insurance required
            </label>
          </div>
        </div>
      )}

      {/* Leased land: new leases only; the lease page manages links
          afterward. Multiple rows = multiple properties on one lease. */}
      {!lease && properties.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between">
            <label
              className={
                "text-sm font-medium text-gray-700" +
                (isUnsure("leased_properties") ? " rounded bg-amber-100 px-1" : "")
              }
            >
              Leased land
            </label>
            <button
              type="button"
              onClick={() =>
                setLand((rows) => [
                  ...rows,
                  { propertyId: "", acres: "", sourceText: null, aiDerived: false },
                ])
              }
              className="text-sm font-medium text-kelly-700 hover:underline"
            >
              + Add property
            </button>
          </div>
          {land.length === 0 ? (
            <p className="text-xs text-gray-500">
              {prefill
                ? "The document did not clearly identify the land. Add the properties this lease covers, or link them later on the lease page."
                : "Add the properties this lease covers (a lease can cover several). You can also link land later on the lease page."}
            </p>
          ) : (
            land.map((row, i) => {
              const matched = properties.find((p) => p.id === row.propertyId);
              return (
                <div key={i} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={row.propertyId}
                      onChange={(e) => {
                        const propertyId = e.target.value;
                        const prop = properties.find((p) => p.id === propertyId);
                        setLand((rows) =>
                          rows.map((r, j) =>
                            j === i
                              ? {
                                  ...r,
                                  propertyId,
                                  aiDerived: false,
                                  acres:
                                    r.acres.trim() === "" && prop?.acres != null
                                      ? String(Math.round(prop.acres * 10) / 10)
                                      : r.acres,
                                }
                              : r
                          )
                        );
                      }}
                      className={
                        "min-w-44 flex-1 rounded-lg border px-2 py-1.5 text-sm " +
                        (row.aiDerived
                          ? "border-amber-400 bg-amber-50"
                          : "border-gray-300")
                      }
                    >
                      <option value="">Pick the property...</option>
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {row.aiDerived && p.id === row.propertyId
                            ? " (suggested match)"
                            : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.1"
                      value={row.acres}
                      onChange={(e) => updateLand(i, { acres: e.target.value })}
                      placeholder="Leased acres"
                      className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      title="Contract acres often differ from GIS acres"
                    />
                    <button
                      type="button"
                      onClick={() => setLand((rows) => rows.filter((_, j) => j !== i))}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  {row.sourceText ? (
                    <p className="text-xs text-gray-500">
                      Document: {'"'}
                      {row.sourceText}
                      {'"'}
                      {row.aiDerived && !row.propertyId
                        ? " (no property matched; pick one or leave unlinked)"
                        : matched && row.aiDerived
                          ? ` matched to ${matched.name}`
                          : ""}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {/* Payment schedule */}
      <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-center justify-between">
          <label className={"text-sm font-medium text-gray-700" + (isUnsure("payment_schedule") ? " rounded bg-amber-100 px-1" : "")}>
            Payment schedule (per year)
          </label>
          {schedule.length < 4 ? (
            <button
              type="button"
              onClick={() =>
                setSchedule((s) => [
                  ...s,
                  { label: s.length === 0 ? "Annual payment" : `Payment ${s.length + 1}`, month: 3, day: 1, percent: null, amount: null },
                ])
              }
              className="text-sm font-medium text-kelly-700 hover:underline"
            >
              + Add payment
            </button>
          ) : null}
        </div>
        {schedule.length === 0 ? (
          <p className="text-xs text-gray-500">
            No schedule set; projections assume one payment of 100% due January 1.
          </p>
        ) : (
          schedule.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                value={row.label}
                onChange={(e) => updateSchedule(i, { label: e.target.value })}
                placeholder="Label"
                className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-gray-500">due</span>
              <input
                type="number"
                min={1}
                max={12}
                value={row.month}
                onChange={(e) => updateSchedule(i, { month: Number(e.target.value) })}
                className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                title="Month"
              />
              <span className="text-xs text-gray-500">/</span>
              <input
                type="number"
                min={1}
                max={31}
                value={row.day}
                onChange={(e) => updateSchedule(i, { day: Number(e.target.value) })}
                className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                title="Day"
              />
              <input
                type="number"
                step="0.1"
                value={row.percent ?? ""}
                onChange={(e) =>
                  updateSchedule(i, { percent: num(e.target.value), amount: null })
                }
                placeholder="% of rent"
                className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-gray-500">or</span>
              <input
                type="number"
                step="0.01"
                value={row.amount ?? ""}
                onChange={(e) =>
                  updateSchedule(i, { amount: num(e.target.value), percent: null })
                }
                placeholder="fixed $"
                className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => setSchedule((s) => s.filter((_, j) => j !== i))}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Special provisions / notes
        </label>
        <textarea
          rows={3}
          value={provisions}
          onChange={(e) => setProvisions(e.target.value)}
          className={inputClass + ring("special_provisions")}
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        onClick={save}
        disabled={busy}
        className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
      >
        {busy ? "Saving..." : lease ? "Save changes" : "Save lease"}
      </button>
    </div>
  );
}
