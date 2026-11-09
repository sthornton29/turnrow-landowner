import { opsContext, opsJson } from "@/lib/ops/auth";
import { datasetIndex, DATASETS, ParamError, runDataset } from "@/lib/ops/data";

// GET /api/ops/data              the datasets, described
// GET /api/ops/data?dataset=...  one dataset (at most 500 rows)
// Read only, bearer token (OPS_TOKEN), one organization (OPS_ORG).
// turnrow-farm docs/OPS_API.md.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const ctx = opsContext(request);
  if (!ctx.ok) return ctx.response;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const name = params.dataset;
  if (!name) return opsJson(datasetIndex());
  delete params.dataset;
  try {
    const out = await runDataset(ctx.client, ctx.orgId, ctx.base, name, params);
    if (!out) return opsJson({ error: `No dataset "${name}".`, datasets: DATASETS.map((d) => d.name) }, 400);
    return opsJson(out);
  } catch (err) {
    if (err instanceof ParamError) return opsJson({ error: err.message, datasets: DATASETS.map((d) => d.name) }, 400);
    return opsJson({ error: err instanceof Error ? err.message : "The read failed." }, 500);
  }
}
