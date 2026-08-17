import Link from "next/link";
import type { ReactNode } from "react";
import type { Geometry } from "geojson";
import { staticMapUrl } from "@/lib/staticMap";

// The shared summary-page kit: every detail route (property, parcel, ag
// field, pasture, timber stand, road, asset, entity) composes these so
// the pages read as one consistent template. Mobile-first; sections
// render only when the caller has content for them.

export function SummaryHeader({
  typeLabel,
  name,
  keyFigure,
  breadcrumb,
  actions,
  children,
}: {
  typeLabel: string;
  name: string;
  keyFigure?: string | null;
  breadcrumb: Array<{ href: string; label: string }>;
  actions?: ReactNode;
  children?: ReactNode; // extra header content (chips, notes)
}) {
  return (
    <div>
      <p className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
        {breadcrumb.map((b, i) => (
          <span key={b.href} className="flex items-center gap-1">
            {i > 0 ? <span>/</span> : null}
            <Link href={b.href} className="hover:underline">
              {b.label}
            </Link>
          </span>
        ))}
      </p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-gray-900">{name}</h1>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {typeLabel}
            </span>
          </div>
          {keyFigure ? (
            <p className="mt-0.5 text-sm font-medium text-pine-900">{keyFigure}</p>
          ) : null}
          {children}
        </div>
        {actions ? <span className="flex flex-wrap gap-2">{actions}</span> : null}
      </div>
    </div>
  );
}

export function MapThumb({
  geometry,
  focus,
}: {
  geometry: Geometry | null | undefined;
  focus: string; // e.g. "field:<id>", for /map?focus=
}) {
  const url = staticMapUrl(geometry);
  if (!url) return null;
  return (
    <Link
      href={`/map?focus=${focus}`}
      className="block overflow-hidden rounded-xl border border-gray-200"
      title="Open on the map"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Map of this boundary" className="h-44 w-full object-cover md:h-56" />
    </Link>
  );
}

export function DetailsCard({
  rows,
}: {
  rows: Array<[string, string | null | undefined]>;
}) {
  const filled = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (filled.length === 0) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Details
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {filled.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-gray-500">{label}</dt>
            <dd className="text-right font-medium text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function RelatedSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string | null;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-gray-900">
        {title}
        {subtitle ? (
          <span className="ml-2 text-sm font-normal text-gray-500">{subtitle}</span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

export function ActionLink({
  href,
  primary = false,
  children,
}: {
  href: string;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          : "rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      }
    >
      {children}
    </Link>
  );
}
