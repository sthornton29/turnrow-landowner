"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LEASE_STATUS_LABELS,
  type LeaseStatus,
  type LeaseTerms,
  type LeaseType,
  type RentStructure,
  type SchedulePayment,
} from "@/lib/leaseLogic";

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
}: {
  orgId: string;
  tenants: Array<{ id: string; name: string }>;
  lease?: ExistingLease | null;
  prefill?: LeasePrefill | null;
  unsure?: string[];
  sourceFile?: File | null;
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
  const [terms, setTerms] = useState<LeaseTerms>(lease?.terms ?? prefill?.terms ?? {});
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
