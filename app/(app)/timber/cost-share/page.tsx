import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { formatDate, formatDollars } from "@/lib/format";
import { COST_SHARE_STATUS_LABELS, PROGRAM_LABELS } from "@/lib/reforestation";
import type { CostShareAwardRow, CostSharePaymentRow } from "@/types/db";
import { CostShareLauncher } from "@/components/timber/CostShareClient";

export const metadata = { title: "Cost-share" };

// COST-SHARE (migration 0047): every program contract on the land, what
// was approved and received, and the obligations still running.

export default async function CostSharePage() {
  const { supabase, profile } = await requireOrg();
  const [{ data: awards }, { data: payments }, { data: properties }, { data: entities }] = await Promise.all([
    supabase.from("cost_share_awards").select("*").order("signed_date", { ascending: false }),
    supabase.from("cost_share_payments").select("*"),
    supabase.from("properties").select("id, name, entity_id").order("name"),
    supabase.from("entities").select("id, name").order("name"),
  ]);
  const list = (awards ?? []) as CostShareAwardRow[];
  const pays = (payments ?? []) as CostSharePaymentRow[];
  const propName = new Map((properties ?? []).map((p) => [p.id, p.name]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">
            <Link href="/timber" className="hover:underline">
              Timber
            </Link>{" "}
            /
          </p>
          <h1 className="text-xl font-semibold text-gray-900">Cost-share</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            NRCS, FSA, Forestry Commission, and other program contracts that help pay for work on the land.
          </p>
        </div>
        <CostShareLauncher
          label="Add a contract"
          orgId={profile.organization_id!}
          properties={properties ?? []}
          entities={entities ?? []}
          award={null}
        />
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          No cost-share contracts yet. Add one for each program contract (EQIP, CSP, CRP pines, AFC
          pine beetle prevention). Then, when you record the work on a stand, link each bill to the
          contract that helped pay it: that keeps the replanting deduction from counting the same
          dollars twice.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((a) => {
            const received = pays.filter((p) => p.award_id === a.id).reduce((s, p) => s + Number(p.amount), 0);
            const undecided = pays.filter((p) => p.award_id === a.id && p.sec126_choice === "undecided").length;
            const obligated = a.obligations_until && a.obligations_until >= today;
            return (
              <li key={a.id} className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link href={`/timber/cost-share/${a.id}`} className="font-semibold text-gray-900 hover:underline">
                    {a.title}
                  </Link>
                  <span className="text-gray-500">
                    {[PROGRAM_LABELS[a.program], propName.get(a.property_id), COST_SHARE_STATUS_LABELS[a.status]]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="ml-auto text-pine-900">
                    {formatDollars(received)} received
                    {a.approved_amount != null ? ` of ${formatDollars(a.approved_amount)} approved` : ""}
                  </span>
                </div>
                {obligated || undecided > 0 ? (
                  <p className="mt-1 text-xs text-amber-800">
                    {[
                      obligated ? `Practices must be kept up until ${formatDate(a.obligations_until)}` : null,
                      undecided > 0 ? `${undecided} payment${undecided === 1 ? "" : "s"} with the tax choice not decided` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
