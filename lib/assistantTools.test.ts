import { describe, expect, it } from "vitest";
import {
  ASSISTANT_TOOLS,
  describeProperties,
  statusCounts,
  toolStatusLabel,
  TOOL_PAGE_LINKS,
  runAssistantTool,
} from "./assistantTools";

describe("assistant tool registry", () => {
  it("every tool has a name, description, and an object input schema", () => {
    expect(ASSISTANT_TOOLS.length).toBeGreaterThan(5);
    for (const t of ASSISTANT_TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect((t.description ?? "").length).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe("object");
    }
    const names = ASSISTANT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("run_sql");
  });

  it("every curated tool has a status label and a page link", () => {
    for (const t of ASSISTANT_TOOLS) {
      expect(toolStatusLabel(t.name)).not.toBe("Checking your records");
      if (t.name !== "run_sql") expect(TOOL_PAGE_LINKS[t.name]).toBeTruthy();
    }
    expect(toolStatusLabel("income_summary", { year: 2025 })).toContain("2025");
  });

  it("unknown tools return an error instead of throwing", async () => {
    const res = await runAssistantTool({} as never, "nope", {});
    expect(res).toEqual({ error: "Unknown tool: nope" });
  });

  it("run_sql rejects writes before touching the database", async () => {
    let called = false;
    const fake = { rpc: async () => { called = true; return { data: [], error: null }; } };
    const res = (await runAssistantTool(fake as never, "run_sql", { sql: "with x as (delete from leases returning id) select * from x" })) as { error?: string };
    expect(res.error).toMatch(/not allowed/);
    expect(called).toBe(false);
  });
});

describe("describeProperties", () => {
  it("reads in plain language", () => {
    expect(describeProperties([])).toBe("no properties yet");
    expect(describeProperties([{ county: "Lawrence" }])).toBe("1 property in Lawrence County");
    expect(
      describeProperties([{ county: "Lawrence" }, { county: "Lawrence" }, { county: "Lawrence" }])
    ).toBe("3 properties in Lawrence County");
    expect(describeProperties([{ county: "Lawrence" }, { county: "Colbert" }])).toBe(
      "2 properties in Lawrence and Colbert counties"
    );
    expect(
      describeProperties([{ county: "A" }, { county: "B" }, { county: "C" }, { county: null }])
    ).toBe("4 properties across 3 counties");
  });
});

describe("statusCounts", () => {
  it("uses the Property Taxes status rule", () => {
    const today = new Date("2026-03-01T00:00:00");
    const statements = [
      { id: "a", amount_due: 100, delinquent_date: "2026-01-01" },
      { id: "b", amount_due: 100, delinquent_date: "2026-01-01" },
      { id: "c", amount_due: 100, delinquent_date: "2027-01-01" },
      { id: "d", amount_due: 100, delinquent_date: "2027-01-01" },
    ];
    const paid = new Map([["a", 100], ["c", 40]]);
    expect(statusCounts(statements, paid, today)).toEqual({
      paid: 1,
      delinquent: 1,
      partial: 1,
      unpaid: 1,
    });
  });
});
