// LIVE fixture snapshot writer. Runs the real two-stage extraction on
// the statement PDFs in fixtures/tax-statements and writes
// <name>.expected.json beside each. Opt in with TAX_FIXTURES_LIVE=1
// (spends API credits); the deterministic suite in taxFixtures.test.ts
// runs on the snapshots every time.
//   TAX_FIXTURES_LIVE=1 npx vitest run lib/taxFixtures.live.test.ts
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { TAX_SEGMENT_PROMPT, TAX_SEGMENT_TOOL, TAX_STATEMENT_PROMPT, TAX_STATEMENT_TOOL } from "@/app/api/extract/taxTools";
import { groupPages, type PageHeader } from "@/lib/taxSegment";

const DIR = path.join(process.cwd(), "fixtures", "tax-statements");
const live = process.env.TAX_FIXTURES_LIVE === "1";
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf")) : [];

function loadEnv() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 0 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

async function slice(buf: Buffer, pages: number[]): Promise<Buffer> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const part = await PDFDocument.create();
  const copied = await part.copyPages(src, pages.map((p) => p - 1));
  for (const p of copied) part.addPage(p);
  return Buffer.from(await part.save({ useObjectStreams: true }));
}

describe.skipIf(!live || files.length === 0)("tax fixture snapshots (live)", () => {
  it("extracts every fixture and writes the snapshots", async () => {
    loadEnv();
    const client = new Anthropic();
    const run = async (bytes: Buffer, tool: Anthropic.Tool, text: string) => {
      const res = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } }, { type: "text", text }] }],
      });
      const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!use) throw new Error("no tool use");
      return use.input as Record<string, unknown>;
    };
    for (const f of files) {
      const buf = fs.readFileSync(path.join(DIR, f));
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const total = src.getPageCount();
      const pages: PageHeader[] = [];
      for (let start = 1; start <= total; start += 8) {
        const count = Math.min(8, total - start + 1);
        const bytes = await slice(buf, Array.from({ length: count }, (_, i) => start + i));
        const r = await run(bytes, TAX_SEGMENT_TOOL, TAX_SEGMENT_PROMPT(start, count));
        for (const [i, p] of ((r.pages as Array<Record<string, unknown>>) ?? []).entries()) {
          const n = Number(p.page_number);
          pages.push({
            page: n >= start && n < start + count ? n : start + i,
            county: (p.county as string) ?? null,
            state: (p.state as string) ?? null,
            billing_key: (p.billing_key as string) ?? null,
            billing_kind: (p.billing_kind as string) ?? null,
            taxpayer_name: (p.taxpayer_name as string) ?? null,
            tax_year: (p.tax_year as number) ?? null,
            total_tax: (p.total_tax as number) ?? null,
            is_continuation: Boolean(p.is_continuation),
            is_statement: p.is_statement !== false,
          });
        }
      }
      const groups = groupPages(pages);
      const statements: unknown[] = [];
      for (const g of groups) {
        const bytes = await slice(buf, g.pages);
        statements.push({ pages: g.pages, extraction: await run(bytes, TAX_STATEMENT_TOOL, TAX_STATEMENT_PROMPT) });
      }
      const snapshot = { file: f, total_pages: total, pages, groups, statements, written_at: new Date().toISOString() };
      fs.writeFileSync(path.join(DIR, f.replace(/\.pdf$/i, ".expected.json")), JSON.stringify(snapshot, null, 2));
      expect(groups.length).toBeGreaterThan(0);
    }
  }, 900_000);
});
