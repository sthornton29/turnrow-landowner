import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { formatAcres, formatDollars, formatNumber } from "@/lib/format";
import { loadIncomeInputs, projectedLeaseYears } from "@/lib/income";
import {
  harvestStatus,
  yieldPerAcre,
  yieldUnitLabel,
  type FarmFieldDataRow,
  type FieldMappingRow,
} from "@/lib/farmDisplay";
import {
  ActionLink,
  DetailsCard,
  MapThumb,
  RelatedSection,
  SummaryHeader,
} from "@/components/summary/Summary";
import EntityDocuments from "@/components/documents/EntityDocuments";
import RowEditor from "@/components/lists/RowEditor";

export const metadata = { title: "Ag field" };

export default async function FieldSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await requireOrg();

  const { data: field } = await supabase
    .from("fields_geo")
    .select("*")
    .eq("id", id)
    .single();
  if (!field) notFound();

  const [
    { data: property },
    { data: leaseLands },
    { data: leases },
    { data: mappings },
    { data: farmData },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name")
      .eq("id", field.property_id)
      .single(),
    supabase.from("lease_lands").select("lease_id, field_id, property_id"),
    supabase.from("leases").select("id, name, status, lease_type"),
    supabase
      .from("field_mappings")
      .select("*")
      .eq("status", "confirmed")
      .eq("local_field_id", id),
    supabase.from("farm_field_data").select("*").order("crop_year", { ascending: false }),
  ]);

  // Leases covering this ag field: linked directly, or covering the
  // whole property.
  const coveringLeaseIds = new Set(
    (leaseLands ?? [])
      .filter(
        (l) =>
          l.field_id === id || (l.field_id === null && l.property_id === field.property_id)
      )
      .map((l) => l.lease_id)
  );
  const coveringLeases = (leases ?? []).filter((l) => coveringLeaseIds.has(l.id));
  const currentYear = new Date().getFullYear();
  const projections =
    coveringLeases.length > 0
      ? projectedLeaseYears(await loadIncomeInputs(supabase))
      : new Map<string, Map<number, number>>();

  // Farm activity on this ag field (mapped remote fields), plus the
  // tenant's planted-by-practice acres beside the GIS irrigation split.
  const mappedKeys = new Set(
    ((mappings ?? []) as FieldMappingRow[]).map(
      (m) => `${m.farm_connection_id}|${m.remote_field_id}`
    )
  );
  const activity = ((farmData ?? []) as FarmFieldDataRow[]).filter((d) =>
    mappedKeys.has(`${d.farm_connection_id}|${d.remote_field_id}`)
  );
  const currentActivity = activity.filter((d) => d.crop_year === currentYear);
  const tenantIrrigated = currentActivity.reduce(
    (s, d) => s + (d.irrigated_acres ?? 0),
    0
  );
  const tenantDryland = currentActivity.reduce((s, d) => s + (d.dryland_acres ?? 0), 0);

  const acres = field.acres ?? 0;
  const irrigated = field.irrigated_acres;
  const keyFigure =
    irrigated != null && irrigated > 0.05
      ? `${formatAcres(acres)} ac: ${formatAcres(irrigated)} irrigated / ${formatAcres(Math.max(acres - irrigated, 0))} dryland`
      : `${formatAcres(acres)} acres`;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <SummaryHeader
        typeLabel="Ag field"
        name={field.name}
        keyFigure={keyFigure}
        breadcrumb={[
          { href: "/properties", label: "Properties" },
          ...(property
            ? [{ href: `/properties/${property.id}`, label: property.name }]
            : []),
          { href: `/fields/${id}`, label: field.name },
        ]}
        actions={
          <ActionLink href={`/map?focus=field:${id}`} primary>
            View on map
          </ActionLink>
        }
      />

      <MapThumb geometry={field.boundary_geojson} focus={`field:${id}`} />

      <DetailsCard
        rows={[
          ["Acres", formatAcres(acres)],
          [
            "Irrigated (GIS coverage)",
            irrigated != null && irrigated > 0.05 ? `${formatAcres(irrigated)} ac` : null,
          ],
          [
            "Dryland (GIS coverage)",
            irrigated != null && irrigated > 0.05
              ? `${formatAcres(Math.max(acres - irrigated, 0))} ac`
              : null,
          ],
          [
            "Tenant planted irrigated",
            tenantIrrigated > 0.05 ? `${formatAcres(tenantIrrigated)} ac (farm data)` : null,
          ],
          [
            "Tenant planted dryland",
            tenantDryland > 0.05 ? `${formatAcres(tenantDryland)} ac (farm data)` : null,
          ],
          ["Notes", field.notes],
        ]}
      />
      <RowEditor entityType="field" row={field} />

      {coveringLeases.length > 0 ? (
        <RelatedSection title="Leases covering this land">
          <ul className="space-y-2">
            {coveringLeases.map((l) => {
              const projected = projections.get(l.id)?.get(currentYear);
              return (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"
                >
                  <Link
                    href={`/leases/${l.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {l.name}
                  </Link>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                    {l.status}
                  </span>
                  {projected !== undefined ? (
                    <span className="ml-auto text-sm tabular-nums text-gray-700">
                      {currentYear} projected: {formatDollars(projected)}
                      <span className="text-xs text-gray-500"> (whole lease)</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </RelatedSection>
      ) : null}

      {activity.length > 0 ? (
        <RelatedSection title="Farm activity" subtitle="from your tenant's farm software">
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Year</th>
                  <th className="px-3 py-2">Crop</th>
                  <th className="px-3 py-2 text-right">Acres</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Yield</th>
                </tr>
              </thead>
              <tbody>
                {activity.slice(0, 8).map((d) => {
                  const perAcre = yieldPerAcre(d);
                  return (
                    <tr key={d.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2">{d.crop_year}</td>
                      <td className="px-3 py-2">{d.crop || "Unknown"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatAcres(d.planted_acres)}
                      </td>
                      <td className="px-3 py-2">
                        {harvestStatus(d) === "harvested" ? "Harvested" : "Growing"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {perAcre !== null
                          ? `${formatNumber(Math.round(perAcre * 10) / 10)} ${yieldUnitLabel(d.production_unit)}`
                          : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </RelatedSection>
      ) : null}

      <RelatedSection title="Documents and photos">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <EntityDocuments
            orgId={profile.organization_id!}
            entityType="field"
            entityId={id}
          />
        </div>
      </RelatedSection>
    </div>
  );
}
