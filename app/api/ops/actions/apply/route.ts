import { opsJson, opsWriteContext } from "@/lib/ops/auth";
import { applyAction } from "@/lib/ops/actions";

// POST /api/ops/actions/apply (2026-11-09): make one previewed change
// after a person confirmed it in Turnrow Farm. A key already applied
// replays its result; a moved fingerprint answers 409 and changes
// nothing; every call is logged in ops_action_log.
// turnrow-farm docs/OPS_ACTIONS.md.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const ctx = opsWriteContext(request);
  if (!ctx.ok) return ctx.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return opsJson({ error: "A JSON body {action, params, fingerprint, key, approved_by} is needed." }, 400);
  const answer = await applyAction(ctx, body as Record<string, unknown>);
  return opsJson(answer.body, answer.status);
}
