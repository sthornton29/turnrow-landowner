"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatAcres } from "@/lib/format";
import type { FieldMappingRow } from "@/lib/farmDisplay";

const STATUS_CLASSES: Record<string, string> = {
  suggested: "bg-amber-50 text-amber-800",
  confirmed: "bg-kelly-50 text-pine-900",
  ignored: "bg-gray-100 text-gray-500",
};

export default function MappingClient({
  connection,
  initialMappings,
  fields,
  properties,
}: {
  connection: { id: string; label: string; status: string };
  initialMappings: FieldMappingRow[];
  fields: Array<{ id: string; name: string; acres: number | null; property_id: string }>;
  properties: Array<{ id: string; name: string }>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [mappings, setMappings] = useState(initialMappings);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propertyName = new Map(properties.map((p) => [p.id, p.name]));

  async function reload() {
    const { data } = await supabase
      .from("field_mappings")
      .select("*")
      .eq("farm_connection_id", connection.id)
      .order("remote_farm")
      .order("remote_name");
    setMappings((data as FieldMappingRow[]) ?? []);
  }

  function valueOf(m: FieldMappingRow): string {
    if (m.status === "ignored") return "ignore";
    if (m.local_field_id) return `field:${m.local_field_id}`;
    if (m.local_property_id) return `property:${m.local_property_id}`;
    return "";
  }

  async function setMapping(m: FieldMappingRow, value: string) {
    setError(null);
    let patch: Partial<FieldMappingRow>;
    if (value === "ignore") {
      patch = { status: "ignored", local_field_id: null, local_property_id: null };
    } else if (value.startsWith("field:")) {
      patch = {
        status: "confirmed",
        local_field_id: value.slice(6),
        local_property_id: null,
      };
    } else if (value.startsWith("property:")) {
      patch = {
        status: "confirmed",
        local_field_id: null,
        local_property_id: value.slice(9),
      };
    } else {
      patch = { status: "suggested", local_field_id: null, local_property_id: null };
    }
    const { error: err } = await supabase
      .from("field_mappings")
      .update(patch)
      .eq("id", m.id);
    if (err) {
      setError("Could not save: " + err.message);
      return;
    }
    setMappings((list) =>
      list.map((x) => (x.id === m.id ? { ...x, ...patch } : x))
    );
  }

  async function confirmSuggestion(m: FieldMappingRow) {
    await supabase.from("field_mappings").update({ status: "confirmed" }).eq("id", m.id);
    setMappings((list) =>
      list.map((x) => (x.id === m.id ? { ...x, status: "confirmed" as const } : x))
    );
  }

  async function checkForNew() {
    setChecking(true);
    try {
      await fetch("/api/farm/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: connection.id }),
      });
    } finally {
      setChecking(false);
      reload();
    }
  }

  const confirmed = mappings.filter((m) => m.status === "confirmed").length;
  const needsReview = mappings.filter(
    (m) => m.status === "suggested"
  ).length;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div>
        <Link href="/farms" className="text-sm text-gray-500 hover:underline">
          &larr; Farm data
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">
          Field mapping: {connection.label}
        </h1>
        <p className="mt-0.5 text-sm text-gray-600">
          Match your farmer{"'"}s fields to yours (or to a whole property if
          you have not drawn fields). {confirmed} confirmed
          {needsReview > 0 ? `, ${needsReview} awaiting review` : ""}.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={checkForNew}
          disabled={checking}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {checking ? "Checking..." : "Check for new shared fields"}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>

      <ul className="space-y-2">
        {mappings.map((m) => (
          <li key={m.id} className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-44 flex-1">
                <p className="font-medium text-gray-900">{m.remote_name ?? m.remote_field_id}</p>
                <p className="text-sm text-gray-500">
                  {[m.remote_farm, m.remote_acres ? `${formatAcres(m.remote_acres)} ac` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <select
                value={valueOf(m)}
                onChange={(e) => setMapping(m, e.target.value)}
                className="min-w-52 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Not mapped</option>
                <optgroup label="Your fields">
                  {fields.map((f) => (
                    <option key={f.id} value={`field:${f.id}`}>
                      {f.name} ({formatAcres(f.acres)} ac) · {propertyName.get(f.property_id) ?? ""}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Whole property">
                  {properties.map((p) => (
                    <option key={p.id} value={`property:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <option value="ignore">Ignore this field</option>
              </select>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_CLASSES[m.status]}`}
              >
                {m.status}
              </span>
              {m.status === "suggested" && (m.local_field_id || m.local_property_id) ? (
                <button
                  onClick={() => confirmSuggestion(m)}
                  className="rounded-lg bg-kelly-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-kelly-600"
                >
                  Confirm match
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {mappings.length === 0 ? (
          <li className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            No shared fields found yet. Try {'"'}Check for new shared fields{'"'}.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
