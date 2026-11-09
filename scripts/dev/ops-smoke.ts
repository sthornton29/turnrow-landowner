// The ops API builders against the live database, read only (service
// role, one organization): prints the brief and each dataset's row count.
//   npx tsx scripts/dev/ops-smoke.ts <organization id>
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m) process.env[m[1]] ??= m[2].replace(/^"|"$/g, ""); }
import { opsServiceClient } from "../../lib/ops/auth";
import { buildBrief } from "../../lib/ops/brief";
import { DATASETS, runDataset } from "../../lib/ops/data";

(async () => {
  const org = process.argv[2];
  const client = opsServiceClient()!;
  const b = await buildBrief(client, org, "https://turnrowland.com");
  console.log(`todos ${b.todos.length}, alerts ${b.alerts.length}`);
  for (const t of b.todos) console.log(`  TODO [${t.status}] ${t.due ?? "-"} ${t.text}`);
  for (const a of b.alerts) console.log(`  ALERT ${a.severity}: ${a.text}`);
  for (const m of b.metrics) console.log(`  ${m.label}: ${m.value} ${m.unit}`);
  for (const d of DATASETS) { const r = await runDataset(client, org, "https://turnrowland.com", d.name, {}); console.log(`  dataset ${d.name}: ${r!.total} rows`); }
  console.log(`brief ${JSON.stringify(b).length} bytes`);
})().catch((e) => { console.error(e); process.exit(1); });
