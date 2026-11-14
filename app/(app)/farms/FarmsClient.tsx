"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyDbError, NO_ACCESS_MESSAGE } from "@/lib/dbErrors";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  describeSyncReply,
  readJsonBody,
  type FarmConnectionRow,
  type SyncReply,
} from "@/lib/farmDisplay";

const STATUS_CLASSES: Record<string, string> = {
  active: "bg-kelly-50 text-pine-900",
  error: "bg-amber-50 text-amber-800",
  revoked: "bg-red-50 text-red-700",
};

interface Connection extends FarmConnectionRow {
  created_at: string;
  // The share's farming entities (migration 0031); empty on a
  // pre-entity farm API.
  entities?: Array<{ id: string; name: string; field_count?: number | null }> | null;
  // When the live handshake last answered (the scope chips show the
  // LIVE state as of this moment; migration 0040).
  scopes_checked_at?: string | null;
  // Per-area outcome of the last sync run, written by lib/farmSync.ts:
  // the current crop year at the top level, the prior one under `prior`.
  sync_detail?: (YearAreas & { year?: number; prior?: YearAreas & { year: number; plantings?: AreaDetail } }) | null;
}

type AreaDetail = { state: string; message?: string; rows?: number; at: string };
type YearAreas = { production?: AreaDetail; prices?: AreaDetail; yields?: AreaDetail };

const AREAS = [
  ["production", "Harvest data"],
  ["prices", "Projected prices"],
  ["yields", "Projected yields"],
] as const;

// A fetch problem on one optional area (harvest data, prices, yields)
// worth an amber line on the card, for the current crop year and the one
// before it. Scope-off is quiet (the chip already reads off).
function areaProblems(c: Connection): string[] {
  const out: string[] = [];
  const detail = c.sync_detail;
  if (!detail) return out;
  const years: Array<{ areas: YearAreas; suffix: string }> = [{ areas: detail, suffix: "" }];
  if (detail.prior) {
    years.push({ areas: detail.prior, suffix: ` (${detail.prior.year})` });
    if (detail.prior.plantings?.state === "error") {
      out.push(
        `The ${detail.prior.year} crop year could not be refreshed, so its numbers are from the last sync that worked. (${detail.prior.plantings.message ?? "the last fetch failed"})`
      );
    }
  }
  for (const { areas, suffix } of years) {
    for (const [area, label] of AREAS) {
      const d = areas[area];
      if (d?.state === "error") {
        out.push(
          area === "production"
            ? `${label}${suffix} could not be refreshed, so the harvest numbers shown are from the last sync that worked. (${d.message ?? "the last fetch failed"})`
            : `${label}${suffix}: ${d.message ?? "the last fetch failed"}`
        );
      }
      if (d?.state === "scope_off")
        out.push(`${label}${suffix}: the farm's endpoints report this scope off (the handshake disagreed; it will settle on the next sync).`);
    }
  }
  return out;
}

export default function FarmsClient({
  initialConnections,
  isAdmin,
}: {
  initialConnections: Connection[];
  // Connecting and disconnecting a farm are admin-only (row level
  // security refuses anyone else, and a member typing the farmer's
  // one-time code would only burn it).
  isAdmin: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [connections, setConnections] = useState(initialConnections);
  const [code, setCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The outcome of Refresh now or Disconnect, shown on that connection's card.
  const [rowNote, setRowNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<{
    operation: string;
    fields: number;
    yields: boolean;
  } | null>(null);

  async function reload() {
    const { data } = await supabase
      .from("farm_connections")
      .select(
        "id, label, status, scopes, scopes_checked_at, sync_detail, operation_name, landowner_name, field_count, entities, last_synced_at, last_error, created_at"
      )
      .order("created_at");
    setConnections((data as Connection[]) ?? []);
  }

  async function connect() {
    setConnecting(true);
    setError(null);
    setConnectedInfo(null);
    try {
      const res = await fetch("/api/farm/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      // Read as text first: a timeout answers with a web page, and
      // res.json() would show a raw parse error.
      const body = await readJsonBody<{
        connection_id?: string;
        handshake?: { operation_name?: string; field_count?: number; scopes?: { yields?: boolean } };
        error?: string;
      }>(res);
      if (!res.ok || !body?.connection_id) {
        // A share code works once. When no answer came back the
        // connection may still have been saved, so show the list.
        setError(
          body?.error ??
            "The connection did not finish. Look at the list below: if the farm is there, it worked. If it is not, ask your farmer for a new code, because each code works only once."
        );
        await reload();
        return;
      }
      setConnectedInfo({
        operation: body.handshake?.operation_name ?? "the farm",
        fields: body.handshake?.field_count ?? 0,
        yields: Boolean(body.handshake?.scopes?.yields),
      });
      setCode("");
      await reload();
      router.push(`/farms/${body.connection_id}/mapping`);
    } catch (err) {
      setError(friendlyDbError(err as Error, "Could not connect. Please try again."));
    } finally {
      setConnecting(false);
    }
  }

  async function refresh(connectionId: string) {
    setSyncing(connectionId);
    setRowNote(null);
    try {
      const res = await fetch("/api/farm/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: connectionId }),
      });
      // Every reply ends in a sentence on the card: success, the farm
      // software's reason, or a plain "it did not go through".
      const body = await readJsonBody<SyncReply>(res);
      setRowNote({ id: connectionId, ...describeSyncReply(res.status, body) });
    } catch (err) {
      setRowNote({
        id: connectionId,
        ok: false,
        text: friendlyDbError(err as Error, "The sync did not go through. Try again in a few minutes."),
      });
    } finally {
      setSyncing(null);
      reload();
      router.refresh();
    }
  }

  // Deleting the connection also deletes, by foreign key, its field
  // mappings, every synced planting and harvest row, and the tenant's
  // cached prices and projected yields (migrations 0006 and 0012).
  // Tenants and leases stay. The confirmation says exactly that.
  async function disconnect(connection: Connection) {
    const message = [
      `Disconnect ${connection.label}?`,
      "This permanently removes everything synced from this farm: every year of plantings, harvest, and yields, the tenant's projected prices and yields, and the field matches you confirmed. Your tenants and leases are kept.",
      connection.status === "revoked"
        ? "Your farmer has already ended this share, so this history cannot be pulled again."
        : "To see it again you would need a new share code from your farmer, and you would match the fields again. If the farmer ends the share first, the history cannot be pulled again.",
      "This cannot be undone.",
    ].join("\n\n");
    if (!window.confirm(message)) return;
    setDisconnecting(connection.id);
    setRowNote(null);
    const { data, error: err } = await supabase
      .from("farm_connections")
      .delete()
      .eq("id", connection.id)
      .select("id");
    setDisconnecting(null);
    if (err || (data ?? []).length === 0) {
      // No error and no row removed is row level security saying no.
      setRowNote({
        id: connection.id,
        ok: false,
        text: err ? friendlyDbError(err, "Could not disconnect this farm. Please try again.") : NO_ACCESS_MESSAGE,
      });
      return;
    }
    reload();
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Farm connections</h1>
        <p className="mt-0.5 text-sm text-gray-600">
          Connect the farm software your tenant uses and see plantings,
          harvest status, and yields (when shared) on your own ag fields. The
          data itself lives on the{" "}
          <Link href="/farm-activity" className="font-medium text-kelly-700 hover:underline">
            Farm Data page
          </Link>
          .
        </p>
      </div>

      {/* Connect a Farm (admins only; see isAdmin above) */}
      {isAdmin ? (
        <section className="space-y-2 rounded-xl border border-kelly-100 bg-kelly-50 p-4">
          <h2 className="text-base font-semibold text-pine-900">Connect a Farm</h2>
          <p className="text-sm text-gray-600">
            Your farmer creates a share in their Turnrow farm software and gives
            you a one-time code (looks like TRW-XXXX-XXXX-XXXX). Enter it here.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="TRW-XXXX-XXXX-XXXX"
              className="min-w-56 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm"
            />
            <button
              onClick={connect}
              disabled={connecting || code.trim().length < 8}
              className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
            >
              {connecting ? "Connecting..." : "Connect"}
            </button>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {connectedInfo ? (
            <p className="text-sm font-medium text-pine-900">
              Connected to {connectedInfo.operation}: {formatNumber(connectedInfo.fields)}{" "}
              fields shared, yields {connectedInfo.yields ? "included" : "not included"}.
            </p>
          ) : null}
        </section>
      ) : (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          Only an admin on your account can connect or disconnect a farm.
        </p>
      )}

      {/* Connections */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">
          Connections ({connections.length})
        </h2>
        {connections.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
            No farms connected yet.
          </p>
        ) : (
          connections.map((c) => (
            <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-900">{c.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_CLASSES[c.status]}`}
                >
                  {c.status === "revoked" ? "Ended by farmer" : c.status}
                </span>
                <span className="text-sm text-gray-500">
                  {formatNumber(c.field_count ?? 0)} fields
                </span>
                <span className="flex flex-wrap gap-1">
                  {(
                    [
                      ["yields", "Yields"],
                      ["projected_prices", "Projected prices"],
                      ["projected_yields", "Projected yields"],
                    ] as Array<[string, string]>
                  ).map(([key, label]) => (
                    <span
                      key={key}
                      className={
                        "rounded-full px-2 py-0.5 text-xs font-medium " +
                        ((c.scopes as Record<string, boolean> | null)?.[key]
                          ? "bg-kelly-100 text-kelly-700"
                          : "bg-gray-100 text-gray-400")
                      }
                      title={
                        (c.scopes as Record<string, boolean> | null)?.[key]
                          ? `${label} shared by your farmer`
                          : `${label} not shared`
                      }
                    >
                      {label}
                    </span>
                  ))}
                  {c.scopes_checked_at ? (
                    <span
                      className="self-center text-[10px] text-gray-400"
                      title="Scopes are re-read from the farm software on every sync; granting or revoking there takes effect on the next sync with nothing to do here."
                    >
                      checked {formatDateTime(c.scopes_checked_at)}
                    </span>
                  ) : null}
                </span>
                {(c.entities ?? []).length > 0 ? (
                  <span className="basis-full text-xs text-gray-600">
                    Entities:{" "}
                    {(c.entities ?? [])
                      .map((e) => (e.field_count ? `${e.name} (${formatNumber(e.field_count)} fields)` : e.name))
                      .join(", ")}
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-gray-400">
                  {c.last_synced_at
                    ? `Last synced ${formatDateTime(c.last_synced_at)}`
                    : "Never synced"}
                </span>
              </div>
              {c.last_error ? (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
                  {c.last_error}
                </p>
              ) : null}
              {areaProblems(c).map((p) => (
                <p
                  key={p}
                  className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
                >
                  {p}
                </p>
              ))}
              {c.sync_detail &&
              (c.sync_detail.production || c.sync_detail.prices || c.sync_detail.yields || c.sync_detail.prior) ? (
                <details className="mt-2 text-xs text-gray-500">
                  <summary className="cursor-pointer select-none">Sync detail</summary>
                  <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                    {[
                      { areas: c.sync_detail as YearAreas & { plantings?: AreaDetail }, year: c.sync_detail.year ?? null },
                      ...(c.sync_detail.prior ? [{ areas: c.sync_detail.prior, year: c.sync_detail.prior.year as number | null }] : []),
                    ].map(({ areas, year }) =>
                      (["plantings", "production", "prices", "yields"] as const).map((area) => {
                        const d = areas[area];
                        if (!d) return null;
                        return (
                          <p key={`${year ?? "current"}-${area}`}>
                            {year ? `${year} ` : ""}
                            {area}: {d.state}
                            {typeof d.rows === "number" ? ` (${formatNumber(d.rows)} rows)` : ""}
                            {d.message ? ` - ${d.message}` : ""}
                            {d.at ? ` @ ${formatDateTime(d.at)}` : ""}
                          </p>
                        );
                      })
                    )}
                  </div>
                </details>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <Link
                  href={`/farms/${c.id}/mapping`}
                  className="font-medium text-kelly-700 hover:underline"
                >
                  Field mapping
                </Link>
                <Link href="/farm-activity" className="font-medium text-kelly-700 hover:underline">
                  Farm activity
                </Link>
                {c.status !== "revoked" ? (
                  <button
                    onClick={() => refresh(c.id)}
                    disabled={syncing === c.id}
                    className="font-medium text-gray-600 hover:underline disabled:opacity-60"
                  >
                    {syncing === c.id ? "Refreshing..." : "Refresh now"}
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    onClick={() => disconnect(c)}
                    disabled={disconnecting === c.id}
                    className="ml-auto font-medium text-red-600 hover:underline disabled:opacity-60"
                  >
                    {disconnecting === c.id ? "Disconnecting..." : "Disconnect"}
                  </button>
                ) : null}
              </div>
              {rowNote?.id === c.id ? (
                <p className={"mt-2 text-sm " + (rowNote.ok ? "font-medium text-pine-900" : "text-red-600")}>
                  {rowNote.text}
                </p>
              ) : null}
            </div>
          ))
        )}
        <p className="text-xs text-gray-500">
          Connections sync automatically every 6 hours; the app always works
          from the last synced data when the farm software is unavailable.
        </p>
      </section>
    </div>
  );
}
