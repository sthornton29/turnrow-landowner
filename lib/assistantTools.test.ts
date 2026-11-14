import { describe, expect, it } from "vitest";
import {
  ASSISTANT_TOOLS,
  describeProperties,
  incomeRecordLines,
  statusCounts,
  toolStatusLabel,
  TOOL_PAGE_LINKS,
  runAssistantTool,
} from "./assistantTools";
import { ASSISTANT_SCHEMA_SUMMARY } from "./assistantSchema";
import { fakeDb } from "./testUtils/fakeDb";

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

// The Income page counts income records (historical rent, solar, tower,
// building rent, and old timber income, migration 0051). The assistant
// used to know nothing about them, so "how much tower rent in 2019?" was
// answered as none.
describe("income records reach the assistant", () => {
  it("the schema text the model sees describes the income_records table and its columns", () => {
    const line = ASSISTANT_SCHEMA_SUMMARY.split(/\r?\n/).find((l) => l.startsWith("- income_records("));
    expect(line).toBeTruthy();
    for (const column of ["year", "received_date", "payer", "entity_id", "property_id", "income_type", "amount", "basis", "needs_review"]) {
      expect(line).toContain(column);
    }
    for (const kind of ["'solar'", "'tower'", "'commercial_rent'", "'timber'", "'farmland_cash_rent'"]) {
      expect(line).toContain(kind);
    }
  });

  it("the income and timber tools say they include income records", () => {
    const tool = (name: string) => ASSISTANT_TOOLS.find((t) => t.name === name)!;
    expect(tool("income_summary").description).toMatch(/income records/);
    expect(tool("income_summary").description).toMatch(/tower/);
    expect(tool("timber_sales_summary").description).toMatch(/income records/);
  });

  it("incomeRecordLines gives one labeled line per kind for the year, received apart from owed", () => {
    const records = [
      { year: 2019, income_type: "tower", amount: 15000, basis: "received" },
      { year: 2019, income_type: "tower", amount: "1250.50", basis: "received" },
      { year: 2019, income_type: "solar", amount: 14348.01, basis: "received" },
      { year: 2019, income_type: "solar", amount: 700, basis: "calculated" },
      { year: 2019, income_type: "share_rent", amount: 5000, basis: "accrued" },
      { year: 2019, income_type: "commercial_rent", amount: 2400 }, // read without a basis: counts
      { year: 2020, income_type: "tower", amount: 99999, basis: "received" },
    ];
    expect(incomeRecordLines(records, 2019)).toEqual([
      { type: "tower", label: "Tower", records: 2, received: 16250.5, owed_or_not_confirmed: 0 },
      { type: "solar", label: "Solar", records: 2, received: 14348.01, owed_or_not_confirmed: 700 },
      { type: "commercial_rent", label: "Building rent", records: 1, received: 2400, owed_or_not_confirmed: 0 },
      { type: "share_rent", label: "Farm rent (crop share)", records: 1, received: 0, owed_or_not_confirmed: 5000 },
    ]);
    expect(incomeRecordLines(records, 2018)).toEqual([]);
    // No year: every year together.
    expect(incomeRecordLines(records, null).find((l) => l.type === "tower")!.received).toBe(116249.5);
  });

  // A read-only stand-in for the few builder calls the timber tool makes
  // (the shared fake has no .not()).
  function stub(tables: Record<string, Array<Record<string, unknown>>>) {
    const query = (rows: Array<Record<string, unknown>>) => {
      const b = {
        select: () => b,
        order: () => b,
        not: () => b,
        eq: (col: string, value: unknown) => query(rows.filter((r) => r[col] === value)),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return b;
    };
    return { from: (table: string) => query(tables[table] ?? []) };
  }

  it("the timber tool adds timber income records as their own line, and its total includes them", async () => {
    const client = stub({
      timber_sales: [{ id: "ts1", sale_name: "2024 thinning", buyer_name: "Mill", sale_type: "pay_as_cut", status: "completed", harvest_type: "first_thinning", contract_date: "2024-03-01", harvest_deadline: null, sale_acres: 80, lump_sum_price: null }],
      timber_settlements: [{ timber_sale_id: "ts1", settlement_date: "2024-06-01", total_amount: 12000 }],
      payments: [],
      timber_sale_stands: [],
      timber_stands: [],
      properties_geo: [{ id: "p1", name: "Home place", county: "Lawrence", state: "AL", acres: 320, entity_id: null }],
      income_records: [
        { year: 2011, received_date: "2011-08-02", payer: "Old Mill Co", property_id: "p1", income_type: "timber", amount: 48250.75, basis: "received" },
        { year: 2011, received_date: null, payer: "Old Mill Co", property_id: null, income_type: "timber", amount: 1000, basis: "calculated" },
        { year: 2011, received_date: null, payer: "Tower Co", property_id: null, income_type: "tower", amount: 15000, basis: "received" },
        { year: 2024, received_date: "2024-09-01", payer: "Pole buyer", property_id: "p1", income_type: "timber", amount: 500, basis: "received" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = (await runAssistantTool(client as never, "timber_sales_summary", {})) as Record<string, any>;
    expect(all.error).toBeUndefined();
    expect(all.received_from_timber_sales).toBe(12000);
    expect(all.timber_income_records).toMatchObject({ records: 3, received: 48750.75, owed_or_not_confirmed: 1000 });
    expect(all.timber_income_records.label).toMatch(/income records/);
    expect(all.total_received).toBe(60750.75);

    // 2011: no timber sale in Turnrow yet, the income is all in records.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const y2011 = (await runAssistantTool(client as never, "timber_sales_summary", { year: 2011 })) as Record<string, any>;
    expect(y2011.received_from_timber_sales).toBe(0);
    expect(y2011.total_received).toBe(48250.75);
    expect(y2011.timber_income_records.items).toEqual([
      { year: 2011, received_date: "2011-08-02", payer: "Old Mill Co", property: "Home place", amount: 48250.75, basis: "received" },
      { year: 2011, received_date: null, payer: "Old Mill Co", property: null, amount: 1000, basis: "calculated" },
    ]);
  });
});

describe("farm_activity leaves out fields marked Ignore", () => {
  it("keeps ignored fields out of the crop totals and the field list", async () => {
    const row = (remote: string, crop: string, acres: number) => ({
      farm_connection_id: "c1", remote_field_id: remote, crop_year: 2026, crop, planted_acres: acres,
      irrigated_acres: null, dryland_acres: null, planting_date: null, harvested_acres: null,
      harvest_status: null, production_units: null, production_unit: null, yield_shared: false,
    });
    const db = fakeDb({
      farm_field_data: [row("a", "Corn", 100), row("b", "Corn", 40), row("c", "Cotton", 25), { ...row("a", "Corn", 77), crop_year: 2025 }],
      field_mappings: [
        { farm_connection_id: "c1", remote_field_id: "a", remote_name: "North 40", local_field_id: "f1", local_property_id: null, status: "confirmed" },
        { farm_connection_id: "c1", remote_field_id: "b", remote_name: "The neighbor's field", local_field_id: null, local_property_id: null, status: "ignored" },
      ],
      fields: [{ id: "f1", name: "North 40", property_id: "p1" }],
      properties_geo: [{ id: "p1", name: "Home place", county: "Lawrence", state: "AL", acres: 320, entity_id: null }],
      farm_connections: [{ id: "c1", label: "Turnrow Farm", operation_name: "Turnrow Farm", status: "active", last_synced_at: null }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await runAssistantTool(db.client as never, "farm_activity", { year: 2026 })) as Record<string, any>;
    expect(out.error).toBeUndefined();
    expect(out.by_crop).toEqual({ Corn: { planted_acres: 100, fields: 1 }, Cotton: { planted_acres: 25, fields: 1 } });
    expect(out.fields.map((f: { field: string }) => f.field)).toEqual(["North 40", "c"]);
    expect(out.sources[0]).toContain("2 field records");
    expect(out.note).toMatch(/Ignore/);
  });
});
