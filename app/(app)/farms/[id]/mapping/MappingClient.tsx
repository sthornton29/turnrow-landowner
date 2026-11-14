"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { friendlyDbError } from "@/lib/dbErrors";
import { formatAcres } from "@/lib/format";
import {
  acresOnlyMatches,
  describeSyncReply,
  nameScore,
  readJsonBody,
  type FieldMappingRow,
  type SyncReply,
} from "@/lib/farmDisplay";

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
  isAdmin,
}: {
  connection: { id: string; label: string; status: string };
  initialMappings: FieldMappingRow[];
  fields: Array<{ id: string; name: string; acres: number | null; property_id: string }>;
  properties: Array<{ id: string; name: string }>;
  // Row level security (migration 0034) shows a member who is not an
  // admin only the farmer's fields already matched to land they can see.
  // Unmatched and ignored fields reach admins alone, so the page says so.
  isAdmin: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [mappings, setMappings] = useState(initialMappings);
  const [checking, setChecking] = useState(false);
  // The outcome of "Check for new shared fields", shown beside the button.
  const [checkNote, setCheckNote] = useState<{ ok: boolean; text: string } | null>(null);
  // A save in flight and a save that failed, both on the row they belong to.
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);

  const propertyName = new Map(properties.map((p) => [p.id, p.name]));
  const fieldById = new Map(fields.map((f) => [f.id, f]));

  // A suggestion that rests on acreage alone (the names have nothing in
  // common; older syncs stored these) is not shown as picked and gets no
  // Confirm button: one tap down the list could hand a 40-acre field's
  // harvest to a different 40-acre field. It is offered as a hint instead.
  function isAcresOnlySuggestion(m: FieldMappingRow): boolean {
    if (m.status !== "suggested" || !m.local_field_id) return false;
    const local = fieldById.get(m.local_field_id);
    return !local || nameScore(m.remote_name, local.name) <= 0;
  }

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
    if (isAcresOnlySuggestion(m)) return "";
    if (m.local_field_id) return `field:${m.local_field_id}`;
    if (m.local_property_id) return `property:${m.local_property_id}`;
    return "";
  }

  async function setMapping(m: FieldMappingRow, value: string) {
    setRowError(null);
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
    setSavingId(m.id);
    const { error: err } = await supabase
      .from("field_mappings")
      .update(patch)
      .eq("id", m.id);
    setSavingId(null);
    if (err) {
      setRowError({ id: m.id, text: friendlyDbError(err, "That choice did not save. Please try again.") });
      return;
    }
    setMappings((list) =>
      list.map((x) => (x.id === m.id ? { ...x, ...patch } : x))
    );
  }

  async function confirmSuggestion(m: FieldMappingRow) {
    setRowError(null);
    setSavingId(m.id);
    const { error: err } = await supabase
      .from("field_mappings")
      .update({ status: "confirmed" })
      .eq("id", m.id);
    setSavingId(null);
    if (err) {
      setRowError({ id: m.id, text: friendlyDbError(err, "That match was not confirmed. Please try again.") });
      return;
    }
    setMappings((list) =>
      list.map((x) => (x.id === m.id ? { ...x, status: "confirmed" as const } : x))
    );
  }

  async function checkForNew() {
    setChecking(true);
    setCheckNote(null);
    try {
      const res = await fetch("/api/farm/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: connection.id }),
      });
      // Always say how it went (a timeout answers with a web page, not JSON).
      setCheckNote(describeSyncReply(res.status, await readJsonBody<SyncReply>(res)));
    } catch (err) {
      setCheckNote({
        ok: false,
        text: friendlyDbError(err as Error, "Could not check for new fields. Try again in a few minutes."),
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
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div>
        <Link href="/farms" className="text-sm text-gray-500 hover:underline">
          &larr; Farm data
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">
          Field mapping: {connection.label}
        </h1>
        <p className="mt-0.5 text-sm text-gray-600">
          Match your farmer{"'"}s fields to your ag fields (or to a whole
          property if you have not drawn them). {confirmed} confirmed
          {needsReview > 0 ? `, ${needsReview} awaiting review` : ""}.
        </p>
        {!isAdmin ? (
          <p className="mt-1 text-sm text-gray-600">
            This list shows only the fields already matched to land you can
            see. An admin on your account matches the rest.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={checkForNew}
          disabled={checking}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {checking ? "Checking..." : "Check for new shared fields"}
        </button>
        {checkNote ? (
          <p className={"text-sm " + (checkNote.ok ? "font-medium text-pine-900" : "text-red-600")}>
            {checkNote.text}
          </p>
        ) : null}
      </div>

      <ul className="space-y-2">
        {mappings.map((m) => {
          // Same-size fields whose names do not match: a hint, never a pick.
          const sameSize =
            m.status === "suggested" && valueOf(m) === ""
              ? acresOnlyMatches({ name: m.remote_name, acres: m.remote_acres }, fields)
              : [];
          return (
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
                  disabled={savingId === m.id}
                  className="min-w-52 rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-60"
                >
                  {/* Unmatching or ignoring a field takes it out of a
                      member's own view, and the save is refused for
                      anyone but an admin, so only admins are offered it. */}
                  {isAdmin || valueOf(m) === "" ? <option value="">Not mapped</option> : null}
                  <optgroup label="Your ag fields">
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
                  {isAdmin || valueOf(m) === "ignore" ? <option value="ignore">Ignore this field</option> : null}
                </select>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_CLASSES[m.status]}`}
                >
                  {m.status}
                </span>
                {m.status === "suggested" && valueOf(m) !== "" ? (
                  <button
                    onClick={() => confirmSuggestion(m)}
                    disabled={savingId === m.id}
                    className="rounded-lg bg-kelly-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
                  >
                    {savingId === m.id ? "Saving..." : "Confirm match"}
                  </button>
                ) : null}
              </div>
              {sameSize.length > 0 ? (
                <p className="mt-1.5 text-xs text-gray-600">
                  About the same size as{" "}
                  {sameSize
                    .slice(0, 3)
                    .map((f) => `${f.name} (${formatAcres(f.acres)} ac)`)
                    .join(", ")}
                  {sameSize.length > 3 ? `, and ${sameSize.length - 3} more` : ""}. Your farmer lists this
                  field at {formatAcres(m.remote_acres)} ac. The names do not match, so pick one from the
                  list only if it is the same field.
                </p>
              ) : null}
              {rowError?.id === m.id ? <p className="mt-1.5 text-sm text-red-600">{rowError.text}</p> : null}
            </li>
          );
        })}
        {mappings.length === 0 ? (
          <li className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            {isAdmin
              ? `No shared fields found yet. Try "Check for new shared fields".`
              : "None of your farmer's fields are matched to land you can see yet. An admin on your account does the matching."}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
