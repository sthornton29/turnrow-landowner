import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { syncConnection } from "@/lib/farmSync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// POST: manual "Refresh now" from the app (user session; RLS scopes rows).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const connectionId = body.connection_id ? String(body.connection_id) : null;

  let query = supabase.from("farm_connections").select("*").neq("status", "revoked");
  if (connectionId) query = query.eq("id", connectionId);
  const { data: connections } = await query;

  const results = [];
  for (const connection of connections ?? []) {
    results.push(await syncConnection(supabase, connection));
  }
  return NextResponse.json({ results });
}

// GET: the Vercel cron (every 6 hours). Authenticated by CRON_SECRET, runs
// with the service role so every organization's active connections sync.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured." },
      { status: 500 }
    );
  }
  const supabase = createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: connections } = await supabase
    .from("farm_connections")
    .select("*")
    .eq("status", "active");

  const results = [];
  for (const connection of connections ?? []) {
    results.push(await syncConnection(supabase, connection));
  }
  return NextResponse.json({ synced: results.length, results });
}
