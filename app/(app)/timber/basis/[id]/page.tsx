import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars } from "@/lib/format";
import { normalizeSettlementLine, type SettlementLine } from "@/lib/leaseLogic";
import type { AllocationMethod, SettlementAllocation } from "@/lib/timberAllocation";
import {
  ACQUISITION_LABELS,
  BASIS_SOURCE_LABELS,
  propertyShareOfSale,
  soldFromSettlements,
  type AcquisitionType,
  type BasisSource,
  type SaleCut,
} from "@/lib/timberBasis";
import type {
  TimberAccountEntryRow,
  TimberAccountProductRow,
  TimberAccountRow,
} from "@/types/db";
import { DetailsCard, SummaryHeader } from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import BasisSetupLauncher from "@/components/timber/BasisSetupLauncher";
import BasisLedger, { type SaleForBasis } from "@/components/timber/BasisLedger";

export const metadata = { title: "Timber basis" };

export default async function TimberAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: account } = await supabase.from("timber_accounts").select("*").eq("id", id).maybeSingle();
  if (!account) notFound();
  const acct = account as TimberAccountRow;

  const [
    { data: property },
    { data: entities },
    { data: products },
    { data: entries },
    { data: allStands },
    { data: saleLinks },
  ] = await Promise.all([
    supabase.from("properties").select("id, name, entity_id").eq("id", acct.property_id).single(),
    supabase.from("entities").select("id, name").order("name"),
    supabase.from("timber_account_products").select("*").eq("account_id", id),
    supabase.from("timber_account_entries").select("*").eq("account_id", id).order("entry_date"),
    supabase.from("timber_stands").select("id, property_id, acres"),
    supabase.from("timber_sale_stands").select("timber_sale_id, timber_stand_id, allocation_pct"),
  ]);

  // Sales that touch this property's stands.
  const standById = new Map((allStands ?? []).map((s) => [s.id, s]));
  const propertyStandIds = new Set(
    (allStands ?? []).filter((s) => s.property_id === acct.property_id).map((s) => s.id)
  );
  const saleIds = Array.from(
    new Set(
      (saleLinks ?? [])
        .filter((l) => propertyStandIds.has(l.timber_stand_id))
        .map((l) => l.timber_sale_id as string)
    )
  );

  let salesForBasis: SaleForBasis[] = [];
  if (saleIds.length > 0) {
    const [{ data: sales }, { data: settlements }, { data: payments }, { data: costs }] = await Promise.all([
      supabase
        .from("timber_sales")
        .select("id, sale_name, sale_type, status, contract_date, allocation_method")
        .in("id", saleIds),
      supabase
        .from("timber_settlements")
        .select("timber_sale_id, settlement_date, lines, total_amount, allocation, created_at")
        .in("timber_sale_id", saleIds),
      supabase.from("payments").select("timber_sale_id, amount, received_date").in("timber_sale_id", saleIds),
      supabase
        .from("timber_costs")
        .select("timber_sale_id, amount, tax_category, property_id")
        .in("timber_sale_id", saleIds)
        .eq("property_id", acct.property_id),
    ]);
    salesForBasis = (sales ?? []).map((sale) => {
      const saleStands = (saleLinks ?? [])
        .filter((l) => l.timber_sale_id === sale.id)
        .map((l) => ({
          id: l.timber_stand_id as string,
          acres: standById.get(l.timber_stand_id)?.acres ?? null,
          allocation_pct: l.allocation_pct as number | null,
          property_id: standById.get(l.timber_stand_id)?.property_id ?? "",
        }));
      const method = (sale.allocation_method ?? "by_acres") as AllocationMethod;
      const saleShare = propertyShareOfSale(method, saleStands, acct.property_id);
      const mySettlements = (settlements ?? []).filter((s) => s.timber_sale_id === sale.id);
      let proceeds = 0;
      // One entry per settlement, with its date: depletion is proposed
      // per tax year of the settlements (lib/timberBasis.ts).
      const cuts: SaleCut[] = [];
      let lastDate: string | null = null;
      // A sale's money counts whichever way it was recorded (settlements
      // and payments both), whatever the sale type says today.
      for (const s of mySettlements) {
        const share = propertyShareOfSale(
          method,
          saleStands,
          acct.property_id,
          s.allocation as SettlementAllocation | null
        );
        proceeds += (Number(s.total_amount) || 0) * share;
        cuts.push({
          date: s.settlement_date,
          createdAt: s.created_at as string | null,
          sold: soldFromSettlements(
            [{ lines: ((s.lines ?? []) as Array<Partial<SettlementLine>>).map(normalizeSettlementLine) }],
            share
          ),
        });
        if (!lastDate || s.settlement_date > lastDate) lastDate = s.settlement_date;
      }
      for (const p of (payments ?? []).filter((x) => x.timber_sale_id === sale.id)) {
        proceeds += (Number(p.amount) || 0) * saleShare;
        if (p.received_date && (!lastDate || p.received_date > lastDate)) lastDate = p.received_date;
      }
      const sellingExpenses = (costs ?? [])
        .filter((c) => c.timber_sale_id === sale.id && c.tax_category === "selling_expense")
        .reduce((s, c) => s + Number(c.amount), 0);
      return {
        id: sale.id,
        name: sale.sale_name,
        saleType: sale.sale_type,
        status: sale.status,
        share: saleShare,
        proceeds: Math.round(proceeds * 100) / 100,
        sellingExpenses: Math.round(sellingExpenses * 100) / 100,
        cuts,
        lastDate: lastDate ?? sale.contract_date ?? null,
      };
    });
  }

  const acq = ACQUISITION_LABELS[acct.acquisition_type as AcquisitionType];
  const entityName = (entities ?? []).find((e) => e.id === acct.entity_id)?.name ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel="Timber basis"
        name={acct.name}
        keyFigure={entityName ?? "No entity"}
        breadcrumb={[
          { href: "/timber", label: "Timber" },
          { href: "/timber/basis", label: "Timber basis" },
          { href: `/timber/basis/${id}`, label: acct.name },
        ]}
      />

      <DetailsCard
        rows={[
          ["Property", property?.name ?? null],
          ["Owner (taxpayer)", entityName ?? "No entity"],
          ["How acquired", acq?.label ?? null],
          [acct.acquisition_type === "inheritance" ? "Date of death" : "Date acquired", acct.acquired_date],
          ["Total cost or value", acct.total_value != null ? formatDollars(acct.total_value) : null],
          ["Land", acct.land_value != null ? formatDollars(acct.land_value) : null],
          ["Timber (opening basis)", acct.timber_value != null ? formatDollars(acct.timber_value) : null],
          ["Improvements", acct.improvements_value != null ? formatDollars(acct.improvements_value) : null],
          ["Source", BASIS_SOURCE_LABELS[acct.basis_source as BasisSource] ?? null],
          ["Acres covered", acct.acres_covered != null ? formatAcres(acct.acres_covered) : null],
          ["Notes", acct.notes],
        ]}
      />
      {property ? (
        <BasisSetupLauncher
          orgId={profile.organization_id!}
          label="Edit setup"
          primary={false}
          property={property}
          entities={entities ?? []}
          account={acct}
          products={(products ?? []) as TimberAccountProductRow[]}
          ledgerEntries={(entries ?? []) as TimberAccountEntryRow[]}
          defaultAcres={acct.acres_covered}
        />
      ) : null}

      <BasisLedger
        orgId={profile.organization_id!}
        accountId={id}
        products={(products ?? []) as TimberAccountProductRow[]}
        entries={(entries ?? []) as TimberAccountEntryRow[]}
        sales={salesForBasis}
      />

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Evidence</h2>
        <p className="mb-2 text-sm text-gray-600">
          Keep the paper behind the basis here: the closing statement, estate appraisal, or timber
          cruise. Keep it for as long as you own the land, plus the years a return can be examined.
        </p>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments orgId={profile.organization_id!} entityType="timber_account" entityId={id} label={acct.name} />
        </div>
      </section>
    </div>
  );
}
