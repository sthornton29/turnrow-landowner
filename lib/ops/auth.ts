// The ops API (2026-11-08): one read-only contract across the Turnrow
// apps (turnrow-farm docs/OPS_API.md). The Turnrow Morning Brief and an
// Assignment in Turnrow Farm read this app with a bearer token. The token
// lives in the environment (OPS_TOKEN, plus OPS_TOKEN_NEXT while rotating);
// no token set means the routes answer 503. Reads use the service role,
// always filtered by the one organization OPS_ORG names (its id).

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

export const OPS_APP = "land";
export const OPS_LABEL = "Turnrow Land";
export const DEFAULT_BASE_URL = "https://turnrowland.com";

const NO_STORE = { "Cache-Control": "no-store" };

export function opsJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

// Null when the request carries a token the environment accepts; otherwise
// the response to send (503 unconfigured, 401 missing or wrong).
export function checkOpsToken(request: Request, env: NodeJS.ProcessEnv = process.env): Response | null {
  return checkBearer(request, [env.OPS_TOKEN, env.OPS_TOKEN_NEXT], "The ops API is not configured.");
}

// The write half (ops actions, 2026-11-09; turnrow-farm
// docs/OPS_ACTIONS.md) takes its own token, OPS_WRITE_TOKEN (plus
// OPS_WRITE_TOKEN_NEXT while rotating). The read token never opens it.
export function checkOpsWriteToken(request: Request, env: NodeJS.ProcessEnv = process.env): Response | null {
  return checkBearer(request, [env.OPS_WRITE_TOKEN, env.OPS_WRITE_TOKEN_NEXT], "Ops actions are not configured.");
}

function checkBearer(request: Request, candidates: Array<string | undefined>, unconfigured: string): Response | null {
  const accepted = candidates.filter((t): t is string => !!t && t.trim().length > 0);
  if (accepted.length === 0) return opsJson({ error: unconfigured }, 503);
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return opsJson({ error: "A bearer token is required." }, 401);
  const given = digest(m[1].trim());
  const ok = accepted.some((t) => timingSafeEqual(digest(t.trim()), given));
  return ok ? null : opsJson({ error: "That token is not accepted." }, 401);
}

export function opsOrg(env: NodeJS.ProcessEnv = process.env): string | null {
  const org = env.OPS_ORG?.trim();
  return org ? org : null;
}

export function opsBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OPS_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function opsServiceClient(env: NodeJS.ProcessEnv = process.env): SupabaseClient | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// The shared gate of both routes: the token, then the organization and a
// client. Either a ready context or the response to send.
export function opsContext(request: Request, env: NodeJS.ProcessEnv = process.env):
  | { ok: true; client: SupabaseClient; orgId: string; base: string }
  | { ok: false; response: Response } {
  return gate(checkOpsToken(request, env), env);
}

// The same gate for the ops actions routes, on the write token.
export function opsWriteContext(request: Request, env: NodeJS.ProcessEnv = process.env):
  | { ok: true; client: SupabaseClient; orgId: string; base: string }
  | { ok: false; response: Response } {
  return gate(checkOpsWriteToken(request, env), env);
}

function gate(denied: Response | null, env: NodeJS.ProcessEnv):
  | { ok: true; client: SupabaseClient; orgId: string; base: string }
  | { ok: false; response: Response } {
  if (denied) return { ok: false, response: denied };
  const orgId = opsOrg(env);
  if (!orgId) return { ok: false, response: opsJson({ error: "OPS_ORG is not set." }, 503) };
  const client = opsServiceClient(env);
  if (!client) return { ok: false, response: opsJson({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured." }, 503) };
  return { ok: true, client, orgId, base: opsBaseUrl(env) };
}
