"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyDbError } from "@/lib/dbErrors";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import { NO_ENTITY } from "@/lib/entities";
import {
  COMMODITY_LABELS,
  COMMODITY_SLUGS,
  ELECTION_LABEL,
  MYA_STATE_LABEL,
  type ElectionType,
  type MyaState,
} from "@/lib/gov/govPayments";
import {
  UNLINKED_FARM,
  farmAllocationTotals,
  type BaseAcreRow,
  type ElectionRow,
  type FarmPropertyLink,
  type FsaFarmRow,
  type ProjectionRow,
  type PropertyAllocation,
} from "@/lib/gov/govProjection";
import type { GovShareRow } from "@/lib/income";
import EntityFilterChips from "@/components/entities/EntityFilterChips";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-kelly-500 focus:outline-none";

// A number typed into a text box: commas are dropped ("1,234.5" is
// 1234.5), blank is null, and anything else that is not a number comes
// back NaN so the caller can refuse it. (Number("1,234.5") is NaN, which
// the database stores as blank: the figure used to vanish on save.)
function parseNumberInput(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (t === "") return null;
  return Number(t);
}

interface PropertyLite {
  id: string;
  name: string;
  entity_id: string | null;
  county: string | null;
  state: string | null;
}

export default function GovPaymentsClient({
  orgId,
  isAdmin,
  isPlatformAdmin,
  framing,
  selectedYear,
  programYear,
  entityFilter,
  properties,
  entities,
  inputs,
  rows,
  allocations,
  configNotice,
  config,
  shareRows,
  leaseTreatments,
}: {
  orgId: string;
  // Account admin (sees every farm and every property link). Other
  // members see only the links to land they have access to, cannot
  // create farms, and cannot remove the last link they can see.
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  framing: "payment" | "program";
  selectedYear: number;
  programYear: number;
  entityFilter: string;
  properties: PropertyLite[];
  entities: Array<{ id: string; name: string }>;
  inputs: {
    farms: FsaFarmRow[];
    links: FarmPropertyLink[];
    baseAcres: BaseAcreRow[];
    elections: ElectionRow[];
    commodities: Array<{ slug: string; name: string }>;
    priceData: Array<{
      commodity: string;
      program_year: number;
      effective_reference_price: number | null;
      mya_price_estimate: number | null;
      mya_price_final: number | null;
      wasde_midpoint: number | null;
      source: string | null;
    }>;
  };
  rows: ProjectionRow[];
  allocations: PropertyAllocation[];
  configNotice: string | null;
  config: { paymentFactor: number; sequestrationPct: number; arcGuaranteePct: number; arcPaymentCapPct: number };
  shareRows: GovShareRow[];
  leaseTreatments: Array<{
    id: string;
    name: string;
    sentence: string;
    treatment: "landowner_share" | "tenant_retains";
    chosen: boolean;
    receivedVia: "fsa_direct" | "tenant_remits" | null;
  }>;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(inputs.farms.length === 0);
  const [methodOpen, setMethodOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const paymentYear = programYear + 1;
  const href = (over: { year?: number; framing?: string; entity?: string }) => {
    const p = new URLSearchParams();
    p.set("year", String(over.year ?? selectedYear));
    p.set("framing", over.framing ?? framing);
    const e = over.entity ?? entityFilter;
    if (e) p.set("entity", e);
    return `/gov-payments?${p.toString()}`;
  };
  const years = [selectedYear - 2, selectedYear - 1, selectedYear, selectedYear + 1];

  const propertyById = new Map(properties.map((p) => [p.id, p]));

  // Entity filter: multi-select comma list (shared semantics with the
  // income page and dashboard). Empty = all. The headline tiles below
  // recompute WITHIN the selection - previously only the by-property
  // groups filtered while the tiles stayed org-wide (same bug class as
  // the income page).
  const selectedKeys = entityFilter.split(",").map((s) => s.trim()).filter(Boolean);
  const filtering = selectedKeys.length > 0;
  const selectedSet = new Set(selectedKeys);
  const scope = filtering
    ? new Set(
        properties
          .filter((p) => selectedSet.has(p.entity_id ?? NO_ENTITY))
          .map((p) => p.id)
      )
    : null;
  const scopedAllocations = scope
    ? allocations.filter((a) => a.propertyId !== UNLINKED_FARM && scope.has(a.propertyId))
    : allocations;
  const scopedShareRows = scope
    ? shareRows.filter((r) => scope.has(r.propertyId))
    : shareRows;
  const scopedLeaseIds = new Set(scopedShareRows.map((r) => r.leaseId));
  const scopedLeaseTreatments = filtering
    ? leaseTreatments.filter((l) => scopedLeaseIds.has(l.id))
    : leaseTreatments;
  const farmById = new Map(inputs.farms.map((f) => [f.id, f]));
  const rowKey = (r: ProjectionRow) => `${r.farmId}|${r.commodity}`;
  const rowByKey = new Map(rows.map((r) => [rowKey(r), r]));

  // Group allocations: entity -> property -> farm -> commodity rows.
  const groups = useMemo(() => {
    const byProperty = new Map<string, PropertyAllocation[]>();
    for (const a of allocations) {
      if (!byProperty.has(a.propertyId)) byProperty.set(a.propertyId, []);
      byProperty.get(a.propertyId)!.push(a);
    }
    const entityOf = (pid: string) =>
      pid === UNLINKED_FARM ? UNLINKED_FARM : (propertyById.get(pid)?.entity_id ?? NO_ENTITY);
    const keys = [...entities.map((e) => e.id), NO_ENTITY, UNLINKED_FARM];
    return keys
      .filter((k) => !filtering || selectedSet.has(k))
      .map((k) => ({
        key: k,
        name: k === UNLINKED_FARM ? "Farms not linked to a property" : k === NO_ENTITY ? "No entity" : (entities.find((e) => e.id === k)?.name ?? "Entity"),
        props: Array.from(byProperty.entries()).filter(([pid]) => entityOf(pid) === k),
      }))
      .filter((g) => g.props.length > 0);
  }, [allocations, entities, entityFilter, propertyById]);

  const totalNet = Math.round(scopedAllocations.reduce((s, a) => s + a.net, 0) * 100) / 100;
  const landownerShare = Math.round(scopedShareRows.reduce((s, r) => s + r.landownerAmount, 0) * 100) / 100;
  // The informational "to your tenant" line belongs only when every
  // share lease leaves the payments with the tenant.
  const tenantRetainsAll =
    scopedLeaseTreatments.length > 0 &&
    scopedLeaseTreatments.every((l) => l.treatment === "tenant_retains");
  const myaFor = (slug: string) => {
    const r = rows.find((x) => x.commodity === slug);
    return r ? { price: r.myaPrice, state: r.myaState as MyaState } : null;
  };

  async function setElection(farmId: string, commodity: string, election: ElectionType) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("fsa_elections").upsert(
      { organization_id: orgId, fsa_farm_id: farmId, commodity, program_year: programYear, election },
      { onConflict: "fsa_farm_id,commodity,program_year" }
    );
    setBusy(false);
    if (err) setError(friendlyDbError(err, "Could not save the election. It was left as it was."));
    else router.refresh();
  }

  // ------------------------------------------------ farm management
  const [farmForm, setFarmForm] = useState<{
    id: string | null;
    farm_number: string;
    state: string;
    county: string;
    farmland_acres: string;
    cropland_acres: string;
    dcp_cropland_acres: string;
    notes: string;
  } | null>(null);

  function editFarm(f: FsaFarmRow | null) {
    setFarmForm(
      f
        ? {
            id: f.id,
            farm_number: f.farm_number,
            state: f.state ?? "",
            county: f.county ?? "",
            farmland_acres: f.farmland_acres == null ? "" : String(f.farmland_acres),
            cropland_acres: f.cropland_acres == null ? "" : String(f.cropland_acres),
            dcp_cropland_acres: String((f as FsaFarmRow & { dcp_cropland_acres?: number | null }).dcp_cropland_acres ?? ""),
            notes: String((f as FsaFarmRow & { notes?: string | null }).notes ?? ""),
          }
        : { id: null, farm_number: "", state: properties[0]?.state ?? "", county: properties[0]?.county ?? "", farmland_acres: "", cropland_acres: "", dcp_cropland_acres: "", notes: "" }
    );
  }

  async function saveFarm() {
    if (!farmForm) return;
    if (!farmForm.farm_number.trim()) {
      setError("Farm number is required.");
      return;
    }
    const farmland = parseNumberInput(farmForm.farmland_acres);
    const cropland = parseNumberInput(farmForm.cropland_acres);
    const dcpCropland = parseNumberInput(farmForm.dcp_cropland_acres);
    if ([farmland, cropland, dcpCropland].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) {
      setError("Farmland acres, cropland acres, and DCP cropland must be numbers (or left blank).");
      return;
    }
    setBusy(true);
    setError(null);
    const patch = {
      organization_id: orgId,
      farm_number: farmForm.farm_number.trim(),
      state: farmForm.state.trim().toUpperCase() || null,
      county: farmForm.county.trim() || null,
      farmland_acres: farmland,
      cropland_acres: cropland,
      dcp_cropland_acres: dcpCropland,
      notes: farmForm.notes.trim() || null,
    };
    const { error: err } = farmForm.id
      ? await supabase.from("fsa_farms").update(patch).eq("id", farmForm.id)
      : await supabase.from("fsa_farms").insert(patch);
    setBusy(false);
    if (err) {
      setError(friendlyDbError(err, "Could not save the farm. What you typed is still here; try again."));
      return;
    }
    setFarmForm(null);
    setMessage("Farm saved.");
    router.refresh();
  }

  async function deleteFarm(f: FsaFarmRow) {
    if (!window.confirm(`Delete FSA farm ${f.farm_number} and its base acres?`)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("fsa_farms").delete().eq("id", f.id);
    setBusy(false);
    if (err) setError(friendlyDbError(err, "Could not delete the farm. Nothing was removed."));
    else router.refresh();
  }

  async function linkProperty(farmId: string, propertyId: string, pct: number) {
    if (!propertyId) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("fsa_farm_properties").upsert(
      { organization_id: orgId, fsa_farm_id: farmId, property_id: propertyId, allocation_pct: pct },
      { onConflict: "fsa_farm_id,property_id" }
    );
    setBusy(false);
    if (err) setError(friendlyDbError(err, "Could not save the property link. It was left as it was."));
    else router.refresh();
  }

  async function unlinkProperty(farm: FsaFarmRow, propertyId: string) {
    if (busy) return;
    const name = propertyById.get(propertyId)?.name ?? "this property";
    if (
      !window.confirm(
        `Remove ${name} from farm ${farm.farm_number}? Its share of this farm's projected payment will no longer count on ${name}. The property and the farm are not deleted.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("fsa_farm_properties")
      .delete()
      .eq("fsa_farm_id", farm.id)
      .eq("property_id", propertyId);
    setBusy(false);
    if (err) setError(friendlyDbError(err, "Could not remove the property link. It is still there."));
    router.refresh();
  }

  // True when saved (the add row clears itself only then).
  async function saveBaseAcres(farmId: string, commodity: string, baseAcres: string, plcYield: string): Promise<boolean> {
    if (busy) return false;
    const acres = parseNumberInput(baseAcres);
    const yld = parseNumberInput(plcYield);
    if ([acres, yld].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) {
      setError("Base acres and PLC yield must be numbers (or left blank).");
      return false;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("fsa_base_acres").upsert(
      {
        organization_id: orgId,
        fsa_farm_id: farmId,
        commodity,
        base_acres: acres,
        plc_yield: yld,
      },
      { onConflict: "fsa_farm_id,commodity" }
    );
    setBusy(false);
    if (err) {
      setError(friendlyDbError(err, "Could not save the base acres. What you typed is still here; try again."));
      return false;
    }
    router.refresh();
    return true;
  }

  async function deleteBaseAcres(farm: FsaFarmRow, commodity: string) {
    if (busy) return;
    const label = COMMODITY_LABELS[commodity as keyof typeof COMMODITY_LABELS] ?? commodity;
    if (!window.confirm(`Remove the ${label} base acres from farm ${farm.farm_number}?`)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("fsa_base_acres")
      .delete()
      .eq("fsa_farm_id", farm.id)
      .eq("commodity", commodity);
    setBusy(false);
    if (err) setError(friendlyDbError(err, "Could not remove the base acres. They are still there."));
    router.refresh();
  }

  // A farm's property percentages should total 100: over 100 counts more
  // than the farm's payment, under 100 leaves part of it on no property.
  // Checked for admins only (other members see only the links to land
  // they have access to, so their totals are partial by design).
  const allocationTotals = farmAllocationTotals(inputs.links);
  const offTotalFarms = isAdmin
    ? inputs.farms.flatMap((farm) => {
        const total = allocationTotals.get(farm.id);
        return total !== undefined && Math.abs(total - 100) > 0.01 ? [{ farm, total }] : [];
      })
    : [];
  const allocationWarning = (total: number) =>
    total > 100
      ? `the property percentages add up to ${formatNumber(total)}%, so ${formatNumber(total)}% of this farm's payment is being counted`
      : `the property percentages add up to ${formatNumber(total)}%, so ${formatNumber(Math.round((100 - total) * 100) / 100)}% of this farm's payment is not counted on any property`;

  const [priceBusy, setPriceBusy] = useState(false);
  async function refreshPrices() {
    setPriceBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/gov/mya-estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        program_year: programYear,
        commodities: Array.from(new Set(inputs.baseAcres.map((b) => b.commodity))),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setPriceBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Could not refresh prices.");
      return;
    }
    const lines = (json.estimates ?? []).map(
      (e: { commodity: string; estimate: number | null; composition: string }) =>
        `${COMMODITY_LABELS[e.commodity as keyof typeof COMMODITY_LABELS] ?? e.commodity}: ${e.estimate == null ? "no published months" : `$${e.estimate.toFixed(4)}`} (${e.composition})`
    );
    // Only a platform admin's refresh saves the blend (the route decides).
    // For everyone else nothing on the page changes, so the line says so.
    setMessage(
      (isPlatformAdmin
        ? "Refreshed from NASS. "
        : "Latest USDA NASS blend, shown for reference only. The prices and projections on this page were not changed; Turnrow keeps the saved season prices current. ") +
        lines.join("; ")
    );
    router.refresh();
  }

  async function lookupBenchmark(farm: FsaFarmRow, commodity: string) {
    if (!farm.county || !farm.state) {
      setError("Set the farm's county and state first.");
      return;
    }
    setPriceBusy(true);
    setError(null);
    const res = await fetch("/api/gov/fsa-benchmark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commodity, county: farm.county, state: farm.state, year: programYear }),
    });
    const json = await res.json().catch(() => ({}));
    setPriceBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Benchmark lookup failed.");
      return;
    }
    const d = json.data;
    setMessage(
      d.not_found
        ? d.source_description
        : `${d.source_description} Benchmark yield ${d.rows?.[0]?.benchmark_yield ?? "n/a"}, price ${d.rows?.[0]?.benchmark_price ?? "n/a"} (cached; the projection now uses it).`
    );
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Government Payments</h1>
        <span className="flex overflow-hidden rounded-lg border border-gray-300 text-sm">
          {(["payment", "program"] as const).map((f) => (
            <Link
              key={f}
              href={href({ framing: f })}
              className={
                "px-3 py-1.5 font-medium " +
                (framing === f ? "bg-kelly-500 text-white" : "bg-white text-gray-600 hover:bg-gray-50")
              }
            >
              {f === "payment" ? "By payment year" : "By program year"}
            </Link>
          ))}
        </span>
        <div className="ml-auto flex gap-1">
          {years.map((y) => (
            <Link
              key={y}
              href={href({ year: y })}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-medium " +
                (y === selectedYear ? "bg-kelly-500 text-white" : "bg-white text-gray-600 hover:bg-gray-50")
              }
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      <p className="text-sm text-gray-700">
        {framing === "payment" ? (
          <>
            <span className="font-semibold text-pine-900">{programYear} program year</span>, paid October {paymentYear}.
            ARC/PLC for a program year is paid in October of the following year, so the cash view of {selectedYear} shows the {programYear} program.
          </>
        ) : (
          <>
            <span className="font-semibold text-pine-900">{programYear} program year</span> (FSA reconciliation view); pays October {paymentYear}.
          </>
        )}
      </p>

      {entities.length > 0 ? (
        <EntityFilterChips
          entities={entities}
          selected={selectedKeys}
          basePath="/gov-payments"
          extraParams={{ year: String(selectedYear), framing }}
        />
      ) : null}

      {configNotice ? (
        <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">{configNotice}</p>
      ) : null}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="rounded-lg bg-kelly-50 px-3 py-2 text-sm text-pine-900">{message}</p> : null}
      {offTotalFarms.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">
            Check the property percentages on {offTotalFarms.length === 1 ? "this farm" : "these farms"}. They should total 100%.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {offTotalFarms.map(({ farm, total }) => (
              <li key={farm.id}>
                Farm {farm.farm_number}: {allocationWarning(total)}.
              </li>
            ))}
          </ul>
          <p className="mt-1">Fix them under FSA farms and base acres below.</p>
        </div>
      ) : null}

      {/* Headline */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Projected payments on your land</p>
          <p className="mt-1 text-2xl font-semibold text-pine-900">{formatDollars(totalNet)}</p>
          <p className="text-xs text-gray-500">net of the {Math.round(config.paymentFactor * 100)}% factor and {(config.sequestrationPct * 100).toFixed(1)}% sequestration</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Your share under leases</p>
          <p className="mt-1 text-2xl font-semibold text-pine-900">{formatDollars(landownerShare)}</p>
          <p className="text-xs text-gray-500">
            {landownerShare > 0
              ? "flows into Income as Government payments"
              : tenantRetainsAll
                ? `base acres on this land generate approximately ${formatDollars(totalNet)}/yr to your tenant`
                : scopedLeaseTreatments.length === 0
                  ? "no crop share or flex lease on this land"
                  : "choose the government payment treatment on each lease"}
          </p>
          {scopedLeaseTreatments.length > 0 ? (
            <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-700">
              {scopedLeaseTreatments.map((l) => (
                <li key={l.id}>
                  <Link href={`/leases/${l.id}`} className="font-medium text-kelly-700 hover:underline">
                    {l.name}
                  </Link>
                  : {l.sentence}
                  {l.receivedVia === "fsa_direct" ? " (paid by FSA directly, not in tenant checks)" : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Prices in use ({programYear})</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {Array.from(new Set(inputs.baseAcres.map((b) => b.commodity))).map((slug) => {
              const m = myaFor(slug);
              return (
                <li key={slug} className="flex justify-between gap-2">
                  <span>{COMMODITY_LABELS[slug as keyof typeof COMMODITY_LABELS] ?? slug}</span>
                  <span className="tabular-nums text-gray-700">
                    {m?.price == null ? "no MYA" : `$${m.price.toFixed(2)}`}{" "}
                    <span className="text-xs text-gray-500">{m ? MYA_STATE_LABEL[m.state] : ""}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <button
            onClick={refreshPrices}
            disabled={priceBusy || inputs.baseAcres.length === 0}
            className="mt-2 text-xs font-medium text-kelly-700 hover:underline disabled:opacity-60"
          >
            {priceBusy ? "Working..." : "Refresh from USDA NASS"}
          </button>
        </div>
      </section>

      {/* By property */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">
          By property, farm, and commodity
        </h2>
        {groups.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            No FSA farms yet. Scan an FSA-156EZ from Documents, or add a farm and its base acres below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Property / farm / commodity</th>
                  <th className="px-4 py-2 text-right">Base acres</th>
                  <th className="px-4 py-2 text-right">PLC yield</th>
                  <th className="px-4 py-2">Election</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Projected (net)</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => [
                  entities.length > 0 || g.key === UNLINKED_FARM ? (
                    <tr key={`${g.key}-h`} className="bg-gray-50 font-semibold text-pine-900">
                      <td className="px-4 py-2" colSpan={5}>{g.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatDollars(g.props.reduce((s, [, list]) => s + list.reduce((t, a) => t + a.net, 0), 0))}
                      </td>
                    </tr>
                  ) : null,
                  ...g.props.flatMap(([pid, list]) => {
                    const byFarm = new Map<string, PropertyAllocation[]>();
                    for (const a of list) {
                      if (!byFarm.has(a.farmId)) byFarm.set(a.farmId, []);
                      byFarm.get(a.farmId)!.push(a);
                    }
                    return [
                      <tr key={`${pid}-p`} className="border-t border-gray-100 font-medium text-gray-900">
                        <td className="px-4 py-2">
                          {pid === UNLINKED_FARM ? (
                            <span className="text-gray-500">Unlinked (link the farm to a property below)</span>
                          ) : (
                            <Link href={`/properties/${pid}`} className="hover:underline">
                              {propertyById.get(pid)?.name ?? "Property"}
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatAcres(list.reduce((s, a) => s + a.baseAcres, 0))}</td>
                        <td colSpan={3}></td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatDollars(list.reduce((s, a) => s + a.net, 0))}</td>
                      </tr>,
                      ...Array.from(byFarm.entries()).flatMap(([farmId, allocs]) => {
                        const farm = farmById.get(farmId);
                        return allocs.map((a) => {
                          const r = rowByKey.get(`${a.farmId}|${a.commodity}`);
                          const key = `${pid}|${a.farmId}|${a.commodity}`;
                          // ARC-IC, and ARC-CO with no county benchmark or no
                          // MYA price: the projection has no flat rate to fall
                          // back on today (nothing supplies one), so the row
                          // has no estimate and adds $0.00. The row and its
                          // drivers say so.
                          const noEstimate = !!r && r.flat && !r.computable;
                          return [
                            <tr key={key} className="border-t border-gray-50">
                              <td className="px-4 py-1.5 pl-8 text-gray-700">
                                <span className="text-xs text-gray-500">Farm {farm?.farm_number ?? "?"}</span>{" "}
                                {COMMODITY_LABELS[a.commodity as keyof typeof COMMODITY_LABELS] ?? a.commodity}
                                {a.allocationPct !== 100 ? <span className="ml-1 text-xs text-gray-400">({a.allocationPct}% of farm)</span> : null}
                                {r ? (
                                  <button onClick={() => setExpanded(expanded === key ? null : key)} className="ml-2 text-xs text-kelly-700 hover:underline">
                                    {expanded === key ? "Hide drivers" : "Drivers"}
                                  </button>
                                ) : null}
                              </td>
                              <td className="px-4 py-1.5 text-right tabular-nums">{formatAcres(a.baseAcres)}</td>
                              <td className="px-4 py-1.5 text-right tabular-nums">{r ? formatNumber(r.plcYield) : ""}</td>
                              <td className="px-4 py-1.5">
                                {r ? (
                                  <select
                                    value={r.election}
                                    disabled={busy}
                                    onChange={(e) => setElection(a.farmId, a.commodity, e.target.value as ElectionType)}
                                    className="rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                                  >
                                    {(Object.keys(ELECTION_LABEL) as ElectionType[]).map((el) => (
                                      <option key={el} value={el}>{ELECTION_LABEL[el]}</option>
                                    ))}
                                  </select>
                                ) : null}
                              </td>
                              <td className="px-4 py-1.5 text-right tabular-nums text-gray-700">
                                {r ? (r.computable ? `$${r.grossPerAcre.toFixed(2)}/ac` : "n/a") : ""}
                                {noEstimate ? (
                                  <span className="block text-xs text-amber-700">no estimate yet, counted as $0.00</span>
                                ) : r?.flat ? (
                                  <span className="ml-1 text-xs text-amber-700">flat est.</span>
                                ) : null}
                              </td>
                              <td className="px-4 py-1.5 text-right tabular-nums font-medium text-pine-900">{formatDollars(a.net)}</td>
                            </tr>,
                            expanded === key && r ? (
                              <tr key={`${key}-d`} className="bg-gray-50">
                                <td colSpan={6} className="px-4 py-2 pl-8 text-xs text-gray-700">
                                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                                    {Object.entries(r.drivers).map(([k, v]) => (
                                      <span key={k}>
                                        <span className="text-gray-500">{k.replace(/_/g, " ")}:</span>{" "}
                                        {typeof v === "number" ? formatNumber(Math.round(v * 10000) / 10000) : v === null ? "none" : String(v)}
                                      </span>
                                    ))}
                                  </div>
                                  {r.notes.map((n) => (
                                    <p key={n} className="mt-1 text-amber-800">{n}</p>
                                  ))}
                                  {noEstimate ? (
                                    <p className="mt-1 text-amber-800">
                                      This row counts as $0.00 in the totals until it can be estimated.
                                    </p>
                                  ) : null}
                                  {r.election === "arc_co" && farm ? (
                                    <button onClick={() => lookupBenchmark(farm, a.commodity)} disabled={priceBusy} className="mt-1 font-medium text-kelly-700 hover:underline">
                                      Look up the FSA county benchmark
                                    </button>
                                  ) : null}
                                </td>
                              </tr>
                            ) : null,
                          ];
                        });
                      }),
                    ];
                  }),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Farm management */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <button onClick={() => setManageOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
          <span className="text-base font-semibold text-gray-900">FSA farms and base acres</span>
          <span className="text-sm text-kelly-700">{manageOpen ? "Hide" : "Manage"}</span>
        </button>
        {manageOpen ? (
          <div className="space-y-4 border-t border-gray-200 p-4">
            <p className="text-sm text-gray-600">
              Scanning an FSA-156EZ under Documents fills these in; you can also enter them by hand. Link each farm to the property it sits on (split with percentages when a farm spans several).
            </p>
            {inputs.farms.map((f) => {
              const links = inputs.links.filter((l) => l.fsa_farm_id === f.id);
              const base = inputs.baseAcres.filter((b) => b.fsa_farm_id === f.id);
              const linkedIds = new Set(links.map((l) => l.property_id));
              return (
                <div key={f.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-gray-900">
                      Farm {f.farm_number}
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        {[f.county, f.state].filter(Boolean).join(", ")}
                        {f.cropland_acres != null ? ` · ${formatAcres(Number(f.cropland_acres))} cropland ac` : ""}
                      </span>
                    </p>
                    <span className="flex gap-2 text-sm">
                      <button onClick={() => editFarm(f)} className="font-medium text-kelly-700 hover:underline">Edit</button>
                      <button onClick={() => deleteFarm(f)} className="font-medium text-red-600 hover:underline">Delete</button>
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Properties</p>
                      {links.map((l) => (
                        <p key={l.property_id} className="flex items-center justify-between gap-2 text-sm">
                          <span>{propertyById.get(l.property_id)?.name ?? "Property"}</span>
                          <span className="flex items-center gap-2">
                            <input
                              type="number"
                              defaultValue={Number(l.allocation_pct)}
                              min={0}
                              max={100}
                              onBlur={(e) => {
                                const pct = e.target.value.trim() === "" ? 0 : Number(e.target.value);
                                if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
                                  setError("A property's share of a farm must be a percentage from 0 to 100.");
                                  e.target.value = String(Number(l.allocation_pct));
                                  return;
                                }
                                if (pct === Number(l.allocation_pct)) return;
                                linkProperty(f.id, l.property_id, pct);
                              }}
                              aria-label={`Percent of farm ${f.farm_number} on ${propertyById.get(l.property_id)?.name ?? "this property"}`}
                              className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs"
                            />
                            <span className="text-xs text-gray-500">%</span>
                            {/* A member who is not an admin reaches a farm only
                                through the property links they can see:
                                removing the last one would lose them the farm. */}
                            {isAdmin || links.length > 1 ? (
                              <button onClick={() => unlinkProperty(f, l.property_id)} disabled={busy} className="text-xs text-red-600 hover:underline disabled:opacity-60">remove</button>
                            ) : null}
                          </span>
                        </p>
                      ))}
                      {isAdmin && Math.abs((allocationTotals.get(f.id) ?? 100) - 100) > 0.01 ? (
                        <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          These should total 100%: {allocationWarning(allocationTotals.get(f.id) ?? 0)}.
                        </p>
                      ) : null}
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          linkProperty(f.id, e.target.value, links.length === 0 ? 100 : 0);
                          e.target.value = "";
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="">+ Link a property</option>
                        {properties.filter((p) => !linkedIds.has(p.id)).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Base acres</p>
                      {base.map((b) => (
                        <BaseAcreEditor
                          key={b.commodity}
                          row={b}
                          busy={busy}
                          onSave={(acres, yld) => saveBaseAcres(f.id, b.commodity, acres, yld)}
                          onDelete={() => deleteBaseAcres(f, b.commodity)}
                        />
                      ))}
                      <AddBaseAcres
                        existing={new Set(base.map((b) => b.commodity))}
                        busy={busy}
                        onAdd={(c, acres, yld) => saveBaseAcres(f.id, c, acres, yld)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {farmForm ? (
              <div className="rounded-lg border border-kelly-200 bg-kelly-50 p-3">
                <p className="mb-2 text-sm font-semibold text-pine-900">{farmForm.id ? "Edit farm" : "New FSA farm"}</p>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {(
                    [
                      ["farm_number", "Farm number"],
                      ["state", "State"],
                      ["county", "County"],
                      ["farmland_acres", "Farmland acres"],
                      ["cropland_acres", "Cropland acres"],
                      ["dcp_cropland_acres", "DCP cropland"],
                    ] as Array<[keyof typeof farmForm, string]>
                  ).map(([k, label]) => (
                    <label key={k} className="text-xs text-gray-700">
                      {label}
                      <input
                        value={String(farmForm[k] ?? "")}
                        onChange={(e) => setFarmForm({ ...farmForm, [k]: e.target.value })}
                        className={inputClass + " mt-0.5"}
                      />
                    </label>
                  ))}
                  <label className="col-span-2 text-xs text-gray-700">
                    Notes
                    <input value={farmForm.notes} onChange={(e) => setFarmForm({ ...farmForm, notes: e.target.value })} className={inputClass + " mt-0.5"} />
                  </label>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={saveFarm} disabled={busy} className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60">
                    {busy ? "Saving..." : "Save farm"}
                  </button>
                  <button onClick={() => setFarmForm(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700">Cancel</button>
                </div>
              </div>
            ) : isAdmin ? (
              // Creating a farm is admin work (row level security refuses
              // it for other members, migration 0034).
              <button onClick={() => editFarm(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                + Add an FSA farm
              </button>
            ) : (
              <p className="text-sm text-gray-500">Adding an FSA farm is done by an admin on your account.</p>
            )}
          </div>
        ) : null}
      </section>

      {/* Methodology */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <button onClick={() => setMethodOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
          <span className="text-base font-semibold text-gray-900">How these numbers are computed</span>
          <span className="text-sm text-kelly-700">{methodOpen ? "Hide" : "Show"}</span>
        </button>
        {methodOpen ? (
          <div className="space-y-3 border-t border-gray-200 p-4 text-sm text-gray-700">
            <p>
              These are estimates. FSA determines actual ARC/PLC payments after each marketing year closes, and payments for a program year arrive in October of the following year. Producer payment limits are not modeled here; they apply to the operator, not to the land.
            </p>
            <div>
              <p className="font-semibold text-gray-900">PLC (Price Loss Coverage)</p>
              <p>
                Payment rate = effective reference price minus the higher of the marketing-year average (MYA) price and the national loan rate, never below zero. Gross = rate x PLC yield x base acres. Net = gross x {Math.round(config.paymentFactor * 100)}% payment factor x (1 minus {(config.sequestrationPct * 100).toFixed(1)}% sequestration).
              </p>
            </div>
            <div>
              <p className="font-semibold text-gray-900">ARC-CO (Agriculture Risk Coverage, county)</p>
              <p>
                Benchmark revenue = benchmark price x benchmark county yield (from FSA{"'"}s annual benchmark workbook). Guarantee = {Math.round(config.arcGuaranteePct * 100)}% of benchmark revenue. Actual revenue = expected county yield x max(MYA, loan rate). The payment rate is the shortfall, capped at {Math.round(config.arcPaymentCapPct * 100)}% of benchmark revenue, then the same factor and sequestration apply. When no county benchmark is on file for the farm{"'"}s county, or no MYA price is on file yet, no estimate is made: the row reads n/a, is marked {'"'}no estimate yet{'"'}, and counts as $0.00 in the totals. Open Drivers on the row to look up the county benchmark.
              </p>
            </div>
            <div>
              <p className="font-semibold text-gray-900">ARC-IC (Agriculture Risk Coverage, individual)</p>
              <p>
                ARC-IC pays on each farm{"'"}s own revenue, which the app does not model. No estimate is made for these rows yet: they read n/a, are marked {'"'}no estimate yet{'"'}, and count as $0.00 in the totals.
              </p>
            </div>
            <div>
              <p className="font-semibold text-gray-900">Prices</p>
              <p>
                MYA precedence: USDA final, then a manual override, then the WASDE season-average midpoint, then a blend of the published USDA NASS monthly prices weighted by typical marketing months. Effective reference prices are the FSA-published values when stored, else the OBBBA formula (88% of the five-year Olympic average, floored at the statutory price and capped at 115% of it). Seed cotton blends upland lint and cottonseed prices in code.
              </p>
            </div>
            <div>
              <p className="font-semibold text-gray-900">Where the land data comes from</p>
              <p>
                Base acres and PLC yields come from your FSA-156EZ (scanned under Documents and confirmed by you) or hand entry. Farms are linked to properties with an allocation percent; a lease{"'"}s share uses its leased acres over the property{"'"}s acres and the lease{"'"}s government payment share percent (default 0: the payment stays with the operator and shows here as information only).
              </p>
            </div>
            <p className="text-xs text-gray-500">
              Sources: USDA NASS Quick Stats (monthly prices received), FSA ARC-County Benchmark Yields and Revenues workbook, FSA-published effective reference prices and OBBBA statutory values (platform-maintained program parameters{isPlatformAdmin ? ", editable under Settings" : ""}).
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function BaseAcreEditor({
  row,
  busy,
  onSave,
  onDelete,
}: {
  row: BaseAcreRow;
  busy: boolean;
  onSave: (acres: string, yld: string) => void;
  onDelete: () => void;
}) {
  const [acres, setAcres] = useState(row.base_acres == null ? "" : String(row.base_acres));
  const [yld, setYld] = useState(row.plc_yield == null ? "" : String(row.plc_yield));
  const dirty = acres !== (row.base_acres == null ? "" : String(row.base_acres)) || yld !== (row.plc_yield == null ? "" : String(row.plc_yield));
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className="w-28 shrink-0">{COMMODITY_LABELS[row.commodity as keyof typeof COMMODITY_LABELS] ?? row.commodity}</span>
      <input value={acres} onChange={(e) => setAcres(e.target.value)} placeholder="acres" className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs" />
      <input value={yld} onChange={(e) => setYld(e.target.value)} placeholder="PLC yield" className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs" />
      {dirty ? (
        <button onClick={() => onSave(acres, yld)} disabled={busy} className="text-xs font-medium text-kelly-700 hover:underline disabled:opacity-60">Save</button>
      ) : null}
      <button onClick={onDelete} disabled={busy} className="text-xs text-red-600 hover:underline disabled:opacity-60">remove</button>
    </p>
  );
}

function AddBaseAcres({
  existing,
  busy,
  onAdd,
}: {
  existing: Set<string>;
  busy: boolean;
  onAdd: (c: string, acres: string, yld: string) => Promise<boolean>;
}) {
  const [commodity, setCommodity] = useState("");
  const [acres, setAcres] = useState("");
  const [yld, setYld] = useState("");
  const options = COMMODITY_SLUGS.filter((s) => !existing.has(s));
  if (options.length === 0) return null;
  return (
    <p className="mt-1 flex items-center gap-2 text-sm">
      <select value={commodity} onChange={(e) => setCommodity(e.target.value)} className="w-28 rounded border border-gray-300 px-1 py-0.5 text-xs">
        <option value="">+ Commodity</option>
        {options.map((s) => (
          <option key={s} value={s}>{COMMODITY_LABELS[s]}</option>
        ))}
      </select>
      <input value={acres} onChange={(e) => setAcres(e.target.value)} placeholder="acres" className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs" />
      <input value={yld} onChange={(e) => setYld(e.target.value)} placeholder="PLC yield" className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs" />
      <button
        disabled={!commodity || busy}
        onClick={async () => {
          // Clear the row only once it saved, so a refused entry stays to be fixed.
          if (!(await onAdd(commodity, acres, yld))) return;
          setCommodity("");
          setAcres("");
          setYld("");
        }}
        className="text-xs font-medium text-kelly-700 hover:underline disabled:opacity-50"
      >
        Add
      </button>
    </p>
  );
}
