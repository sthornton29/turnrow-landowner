import { requireOrg } from "@/lib/auth";
import { loadGovInputs, projectOrg } from "@/lib/gov/govData";
import { programConfigNotice } from "@/lib/gov/programConfig";
import { loadIncomeInputs, govShareRows } from "@/lib/income";
import { govPaymentTreatment, govTreatmentSentence } from "@/lib/leaseLogic";
import GovPaymentsClient from "./GovPaymentsClient";

export const metadata = { title: "Government Payments" };

// ARC/PLC projections for the base acres on the landowner's ground: by
// property and by entity, per commodity, in program-year or payment-year
// framing. All numbers are estimates; FSA settles actual payments after
// the marketing year closes. Producer payment limits are deliberately not
// modeled (the tenant's world).
export default async function GovPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; framing?: string; entity?: string }>;
}) {
  const { supabase, profile } = await requireOrg();
  const { year: yearParam, framing: framingParam, entity: entityParam } = await searchParams;
  const framing = framingParam === "program" ? "program" : "payment";
  const currentYear = new Date().getFullYear();
  const selectedYear = Number(yearParam) || currentYear;
  // The page's math is keyed to the PROGRAM year; the payment-year framing
  // shows program year Y-1 under the heading "paid October Y".
  const programYear = framing === "payment" ? selectedYear - 1 : selectedYear;

  const [gov, income, { data: properties }, { data: entities }] = await Promise.all([
    loadGovInputs(supabase),
    loadIncomeInputs(supabase),
    supabase.from("properties").select("id, name, entity_id, county, state").order("name"),
    supabase.from("entities").select("id, name").order("name"),
  ]);
  const projection = projectOrg(gov, programYear);
  const shareRows = govShareRows(income, programYear + 1);
  const { data: leaseNameRows } = await supabase.from("leases").select("id, name");
  const leaseName = new Map(((leaseNameRows ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name]));
  // How each share/flex lease treats government payments, for the page.
  const leaseTreatments = income.leases
    .filter(
      (l) =>
        (l.rent_structure === "crop_share" || l.rent_structure === "flex") &&
        l.status !== "expired" &&
        l.status !== "terminated"
    )
    .map((l) => {
      const r = govPaymentTreatment(l.terms);
      return {
        id: l.id,
        name: leaseName.get(l.id) ?? "Lease",
        sentence: govTreatmentSentence(l.terms),
        treatment: r.treatment,
        chosen: r.chosen,
        receivedVia: r.receivedVia,
      };
    });

  return (
    <GovPaymentsClient
      orgId={profile.organization_id!}
      isPlatformAdmin={!!profile.is_platform_admin}
      framing={framing}
      selectedYear={selectedYear}
      programYear={programYear}
      entityFilter={entityParam ?? ""}
      properties={(properties ?? []) as Array<{ id: string; name: string; entity_id: string | null; county: string | null; state: string | null }>}
      entities={(entities ?? []) as Array<{ id: string; name: string }>}
      inputs={{
        farms: gov.farms,
        links: gov.links,
        baseAcres: gov.baseAcres,
        elections: gov.elections,
        commodities: gov.commodities.map((c) => ({ slug: String(c.slug), name: c.name })),
        priceData: gov.priceData.map((p) => ({
          commodity: p.commodity,
          program_year: Number(p.program_year),
          effective_reference_price: p.effective_reference_price == null ? null : Number(p.effective_reference_price),
          mya_price_estimate: p.mya_price_estimate == null ? null : Number(p.mya_price_estimate),
          mya_price_final: p.mya_price_final == null ? null : Number(p.mya_price_final),
          wasde_midpoint: p.wasde_midpoint == null ? null : Number(p.wasde_midpoint),
          source: p.source ?? null,
        })),
      }}
      rows={projection.rows}
      allocations={projection.allocations}
      configNotice={programConfigNotice(projection.config)}
      config={{
        paymentFactor: projection.config.paymentFactor,
        sequestrationPct: projection.config.sequestrationPct,
        arcGuaranteePct: projection.config.arcGuaranteePct,
        arcPaymentCapPct: projection.config.arcPaymentCapPct,
      }}
      shareRows={shareRows}
      leaseTreatments={leaseTreatments}
    />
  );
}
