import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Per-user hourly limits for the AI routes (extraction, data assistant,
// help chat, support contact). Backed by the assistant_usage table
// (migration 0020, org RLS, one row per call); before that migration
// runs, or if the table is ever missing, an in-memory map keeps the
// limit working for this server instance.

export type UsageKind = "assistant" | "support_chat" | "support_contact" | "extract";

const memory = new Map<string, number[]>();
const HOUR_MS = 60 * 60 * 1000;

function memoryCheck(key: string, limitPerHour: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const recent = (memory.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  if (recent.length >= limitPerHour) {
    memory.set(key, recent);
    return { allowed: false, remaining: 0 };
  }
  recent.push(now);
  memory.set(key, recent);
  return { allowed: true, remaining: limitPerHour - recent.length };
}

export async function checkRateLimit(
  supabase: SupabaseClient,
  opts: { userId: string; orgId: string | null; kind: UsageKind; limitPerHour: number; tokens?: number }
): Promise<{ allowed: boolean; remaining: number }> {
  const { userId, orgId, kind, limitPerHour } = opts;
  const memKey = `${userId}|${kind}`;
  if (!orgId) return memoryCheck(memKey, limitPerHour);
  const since = new Date(Date.now() - HOUR_MS).toISOString();
  const { count, error } = await supabase
    .from("assistant_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since);
  if (error) {
    // 42P01 = relation does not exist (migration not run yet); any
    // other failure also falls back so a logging hiccup never blocks.
    return memoryCheck(memKey, limitPerHour);
  }
  const used = count ?? 0;
  if (used >= limitPerHour) return { allowed: false, remaining: 0 };
  const { error: insErr } = await supabase.from("assistant_usage").insert({
    organization_id: orgId,
    user_id: userId,
    kind,
    tokens: opts.tokens ?? null,
  });
  if (insErr) return memoryCheck(memKey, limitPerHour);
  return { allowed: true, remaining: limitPerHour - used - 1 };
}

const KIND_COPY: Record<UsageKind, string> = {
  assistant: "You have asked the assistant a lot this hour. Give it a few minutes and try again.",
  support_chat: "The help chat is resting for a bit. Try again in a few minutes, or use Contact support.",
  support_contact: "Several support messages were just sent. Please wait a few minutes before sending another.",
  extract: "Many documents were scanned this hour. Give it a few minutes and scan again.",
};

export function rateLimited429(kind: UsageKind) {
  return NextResponse.json({ error: KIND_COPY[kind] }, { status: 429 });
}
