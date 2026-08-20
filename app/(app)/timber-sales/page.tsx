import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars } from "@/lib/format";
import SectionTabs from "@/components/leases/SectionTabs";
import SettlementUpload from "@/components/timber/SettlementUpload";

export const metadata = { title: "Timber sales" };

const STATUS_CLASSES: Record<string, string> = {
  active: "bg-kelly-50 text-pine-900",
  completed: "bg-gray-100 text-gray-600",
  expired: "bg-amber-50 text-amber-800",
};

export default async function TimberSalesPage() {
  const { supabase, profile } = await requireOrg();

  const [{ data: sales }, { data: settlements }] = await Promise.all([
    supabase
      .from("timber_sales")
      .select(
        "id, sale_name, buyer_name, sale_type, delivered_net, status, contract_date, harvest_deadline, sale_acres, lump_sum_price, stumpage_rates, allocation_method"
      )
      .order("contract_date", { ascending: false }),
    supabase.from("timber_settlements").select("timber_sale_id, total_amount"),
  ]);

  const settledBySale = new Map<string, number>();
  for (const s of settlements ?? []) {
    settledBySale.set(
      s.timber_sale_id,
      (settledBySale.get(s.timber_sale_id) ?? 0) + (s.total_amount ?? 0)
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <SectionTabs active="/timber-sales" />

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-gray-600">
          Lump sum, pay-as-cut, and delivered-price timber sale contracts.
        </p>
        <span className="ml-auto flex gap-2">
          {(sales ?? []).some((s) => s.sale_type === "pay_as_cut") ? (
            <SettlementUpload
              orgId={profile.organization_id!}
              sales={(sales ?? []).map((s) => ({
                id: s.id,
                sale_name: s.sale_name,
                buyer_name: s.buyer_name,
                sale_type: s.sale_type,
                status: s.status,
                delivered_net: s.delivered_net,
                allocation_method: s.allocation_method,
                stumpage_rates: s.stumpage_rates,
              }))}
            />
          ) : null}
          <Link
            href="/timber-sales/new"
            className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          >
            + New timber sale
          </Link>
        </span>
      </div>

      {(sales ?? []).length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No timber sales yet. Create one by uploading the contract (AI
          extraction) or entering terms manually.
        </div>
      ) : (
        <ul className="space-y-2">
          {(sales ?? []).map((s) => (
            <li key={s.id} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/timber-sales/${s.id}`}
                  className="font-medium text-gray-900 hover:underline"
                >
                  {s.sale_name}
                </Link>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {s.sale_type === "lump_sum" ? "Lump sum" : "Pay as cut"}
                </span>
                {s.delivered_net ? (
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
                    Delivered (net)
                  </span>
                ) : null}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_CLASSES[s.status] ?? ""}`}
                >
                  {s.status}
                </span>
                <span className="ml-auto text-sm text-gray-500">
                  {s.buyer_name ?? ""}
                  {s.sale_acres ? ` · ${formatAcres(s.sale_acres)} ac` : ""}
                  {s.sale_type === "lump_sum" && s.lump_sum_price
                    ? ` · ${formatDollars(s.lump_sum_price)}`
                    : ""}
                  {s.sale_type === "pay_as_cut"
                    ? ` · settled ${formatDollars(settledBySale.get(s.id) ?? 0)}`
                    : ""}
                  {s.harvest_deadline ? ` · deadline ${s.harvest_deadline}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
