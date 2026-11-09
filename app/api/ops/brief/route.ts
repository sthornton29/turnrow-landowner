import { opsContext, opsJson } from "@/lib/ops/auth";
import { buildBrief } from "@/lib/ops/brief";

// GET /api/ops/brief (2026-11-08): what needs the landowner today, for the
// Turnrow Morning Brief and Turnrow Farm's Assignments. Read only, bearer
// token (OPS_TOKEN), one organization (OPS_ORG). turnrow-farm docs/OPS_API.md.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = opsContext(request);
  if (!ctx.ok) return ctx.response;
  try {
    return opsJson(await buildBrief(ctx.client, ctx.orgId, ctx.base));
  } catch (err) {
    return opsJson({ error: err instanceof Error ? err.message : "The brief failed." }, 500);
  }
}
