import { opsJson, opsWriteContext } from "@/lib/ops/auth";
import { actionCatalog } from "@/lib/ops/actions";

// GET /api/ops/actions (2026-11-09): the fixes Turnrow Farm's Assignments
// may preview and, on a person's Confirm, apply here. Bearer token
// OPS_WRITE_TOKEN (the read token is refused), one organization
// (OPS_ORG). turnrow-farm docs/OPS_ACTIONS.md.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = opsWriteContext(request);
  if (!ctx.ok) return ctx.response;
  return opsJson(actionCatalog());
}
