import { opsJson, opsWriteContext } from "@/lib/ops/auth";
import { ActionError, previewAction } from "@/lib/ops/actions";

// POST /api/ops/actions/preview (2026-11-09): what one action would
// change, with the fingerprint apply checks. Reads only; writes nothing.
// turnrow-farm docs/OPS_ACTIONS.md.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const ctx = opsWriteContext(request);
  if (!ctx.ok) return ctx.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return opsJson({ error: "A JSON body {action, params} is needed." }, 400);
  try {
    return opsJson(await previewAction(ctx, body as Record<string, unknown>));
  } catch (err) {
    if (err instanceof ActionError) return opsJson({ error: err.message, ...err.extra }, err.status);
    return opsJson({ error: err instanceof Error ? err.message : "The preview failed." }, 500);
  }
}
