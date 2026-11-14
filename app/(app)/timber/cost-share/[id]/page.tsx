import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDate, formatDollars } from "@/lib/format";
import { COST_SHARE_STATUS_LABELS, PROGRAM_LABELS } from "@/lib/reforestation";
import { TAX_CATEGORIES, type TaxCategory } from "@/lib/standActivities";
import type { CostShareAwardRow, CostSharePaymentRow } from "@/types/db";
import { DetailsCard, SummaryHeader } from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import { CostShareLauncher, CostSharePayments } from "@/components/timber/CostShareClient";

export const metadata = { title: "Cost-share" };

export default async function CostShareAwardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();
  const { data: award } = await supabase.from("cost_share_awards").select("*").eq("id", id).maybeSingle();
  if (!award) notFound();
  const a = award as CostShareAwardRow;

  const [{ data: payments }, { data: costs }, { data: properties }, { data: entities }] = await Promise.all([
    supabase.from("cost_share_payments").select("*").eq("award_id", id),
    supabase
      .from("timber_costs")
      .select("id, paid_date, amount, vendor, description, tax_category, activity_id")
      .eq("cost_share_award_id", id)
      .order("paid_date"),
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("entities").select("id, name").order("name"),
  ]);
  // The first stand of each linked cost's activity, for a link back.
  const activityIds = Array.from(new Set((costs ?? []).map((c) => c.activity_id).filter(Boolean))) as string[];
  const { data: links } = activityIds.length
    ? await supabase.from("stand_activity_stands").select("activity_id, timber_stand_id").in("activity_id", activityIds)
    : { data: [] as Array<{ activity_id: string; timber_stand_id: string }> };
  const standFor = new Map((links ?? []).map((l) => [l.activity_id, l.timber_stand_id]));
  const property = (properties ?? []).find((p) => p.id === a.property_id);
  const entityName = (entities ?? []).find((e) => e.id === a.entity_id)?.name ?? null;
  const linkedTotal = (costs ?? []).reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel={PROGRAM_LABELS[a.program] ?? "Cost-share"}
        name={a.title}
        keyFigure={a.approved_amount != null ? `${formatDollars(a.approved_amount)} approved` : (COST_SHARE_STATUS_LABELS[a.status] ?? "")}
        breadcrumb={[
          { href: "/timber", label: "Timber" },
          { href: "/timber/cost-share", label: "Cost-share" },
          { href: `/timber/cost-share/${id}`, label: a.title },
        ]}
      />
      <DetailsCard
        rows={[
          ["Property", property?.name ?? null],
          ["Contract holder", entityName ?? "No entity"],
          ["Program", PROGRAM_LABELS[a.program] ?? a.program],
          ["Agency", a.agency],
          ["Contract number", a.contract_number],
          ["Status", COST_SHARE_STATUS_LABELS[a.status] ?? a.status],
          ["Signed", formatDate(a.signed_date) || null],
          ["Ends", formatDate(a.end_date) || null],
          ["Acres", a.acres != null ? formatAcres(a.acres) : null],
          ["Practices", a.practices],
          ["Keep practices up until", formatDate(a.obligations_until) || null],
          ["Notes", a.notes],
        ]}
      />
      <CostShareLauncher
        label="Edit"
        primary={false}
        orgId={profile.organization_id!}
        properties={properties ?? []}
        entities={entities ?? []}
        award={a}
      />

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Payments received</h2>
        <CostSharePayments
          orgId={profile.organization_id!}
          awardId={id}
          payments={(payments ?? []) as CostSharePaymentRow[]}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Costs it helped pay
          {linkedTotal > 0 ? <span className="ml-2 text-sm font-normal text-gray-500">{formatDollars(linkedTotal)}</span> : null}
        </h2>
        {(costs ?? []).length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            None linked yet. When you record the work on a stand (Record work, then + Add a cost), pick
            this contract on each bill it helped pay.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {(costs ?? []).map((c) => {
              const standId = c.activity_id ? standFor.get(c.activity_id) : null;
              return (
                <li key={c.id} className="flex flex-wrap gap-x-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <span className="text-xs text-gray-500">{formatDate(c.paid_date)}</span>
                  {standId ? (
                    <Link href={`/timber/${standId}`} className="text-gray-900 hover:underline">
                      {c.description ?? c.vendor ?? "Cost"}
                    </Link>
                  ) : (
                    <span className="text-gray-900">{c.description ?? c.vendor ?? "Cost"}</span>
                  )}
                  <span className="text-gray-500">{TAX_CATEGORIES[c.tax_category as TaxCategory]?.short ?? c.tax_category}</span>
                  <span className="ml-auto font-medium">{formatDollars(Number(c.amount))}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Contract and approvals</h2>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments orgId={profile.organization_id!} entityType="cost_share_award" entityId={id} label={a.title} />
        </div>
      </section>
    </div>
  );
}
