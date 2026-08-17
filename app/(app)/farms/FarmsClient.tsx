"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatNumber } from "@/lib/format";
import type { FarmConnectionRow } from "@/lib/farmDisplay";

const STATUS_CLASSES: Record<string, string> = {
  active: "bg-kelly-50 text-pine-900",
  error: "bg-amber-50 text-amber-800",
  revoked: "bg-red-50 text-red-700",
};

interface Connection extends FarmConnectionRow {
  created_at: string;
}

export default function FarmsClient({
  initialConnections,
}: {
  initialConnections: Connection[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [connections, setConnections] = useState(initialConnections);
  const [code, setCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectedInfo, setConnectedInfo] = useState<{
    operation: string;
    fields: number;
    yields: boolean;
  } | null>(null);

  async function reload() {
    const { data } = await supabase
      .from("farm_connections")
      .select(
        "id, label, status, scopes, operation_name, landowner_name, field_count, last_synced_at, last_error, created_at"
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
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not connect.");
      setConnectedInfo({
        operation: body.handshake.operation_name,
        fields: body.handshake.field_count,
        yields: Boolean(body.handshake.scopes?.yields),
      });
      setCode("");
      await reload();
      router.push(`/farms/${body.connection_id}/mapping`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setConnecting(false);
    }
  }

  async function refresh(connectionId: string) {
    setSyncing(connectionId);
    setError(null);
    try {
      await fetch("/api/farm/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: connectionId }),
      });
    } finally {
      setSyncing(null);
      reload();
      router.refresh();
    }
  }

  async function disconnect(connection: Connection) {
    if (
      !window.confirm(
        `Disconnect ${connection.label}? The stored key is removed; synced history stays until you delete it.`
      )
    ) {
      return;
    }
    await supabase.from("farm_connections").delete().eq("id", connection.id);
    reload();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
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

      {/* Connect a Farm */}
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
                </span>
                <span className="ml-auto text-xs text-gray-400">
                  {c.last_synced_at
                    ? `Last synced ${new Date(c.last_synced_at).toLocaleString()}`
                    : "Never synced"}
                </span>
              </div>
              {c.last_error ? (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
                  {c.last_error}
                </p>
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
                <button
                  onClick={() => disconnect(c)}
                  className="ml-auto font-medium text-red-600 hover:underline"
                >
                  Disconnect
                </button>
              </div>
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
