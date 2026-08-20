import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { normalizeSettlementLine, normalizeStumpageRate } from "./leaseLogic";
import {
  cellToIsoDate,
  collapseLoads,
  csvToRows,
  rateMismatch,
  workbookToRows,
  type SettlementColumnMap,
} from "./timberSettlement";

// Fixture: a per-load logger settlement sheet the way mills actually
// send them (title row, header row, one row per scale ticket, a totals
// row that must be skipped). Built with the same xlsx library the app
// parses with, so the test exercises the real round trip.
function fixtureWorkbook(): ArrayBuffer {
  const aoa = [
    ["Ridgeline Timber Co. - Settlement week of 3/2/2026", null, null, null, null, null],
    ["Ticket", "Date", "Product", "Net Tons", "Rate", "Amount"],
    [10412, "3/2/2026", "PINE SAWTIMBER", 26.41, 30.0, 792.3],
    [10413, "3/2/2026", "Pine Pulpwood", 28.02, 9.5, 266.19],
    [10418, "3/4/2026", "PINE SAWTIMBER", 25.16, 30.0, 754.8],
    [10422, "3/5/2026", "Pine Pulpwood", 27.5, 9.5, 261.25],
    [10425, "3/6/2026", "PINE SAWTIMBER", 27.03, 28.5, 770.36],
    [null, null, "TOTAL", null, null, 2844.9],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Settlement");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const MAP: SettlementColumnMap = {
  header_row: 1,
  ticket: 0,
  date: 1,
  product: 2,
  quantity: 3,
  rate: 4,
  amount: 5,
  unit: "ton",
  products: [
    { raw: "PINE SAWTIMBER", product: "pine_sawtimber", label: "Pine sawtimber" },
    { raw: "Pine Pulpwood", product: "pine_pulpwood", label: "Pine pulpwood" },
  ],
};

describe("settlement spreadsheet ingestion", () => {
  it("collapses per-load rows to per-product period lines with load count and date range", () => {
    const rows = workbookToRows(fixtureWorkbook());
    const lines = collapseLoads(rows, MAP);
    expect(lines).toHaveLength(2);

    const saw = lines.find((l) => l.product === "pine_sawtimber")!;
    expect(saw.quantity).toBeCloseTo(26.41 + 25.16 + 27.03, 2);
    expect(saw.amount).toBeCloseTo(792.3 + 754.8 + 770.36, 2);
    expect(saw.load_count).toBe(3);
    expect(saw.date_from).toBe("2026-03-02");
    expect(saw.date_to).toBe("2026-03-06");
    // Weighted average across the mixed 30.00 / 28.50 loads
    expect(saw.rate).toBeCloseTo(saw.amount / saw.quantity, 2);
    expect(saw.unit).toBe("ton");

    const pulp = lines.find((l) => l.product === "pine_pulpwood")!;
    expect(pulp.quantity).toBeCloseTo(55.52, 2);
    expect(pulp.rate).toBeCloseTo(9.5, 2);
    expect(pulp.load_count).toBe(2);
    // The TOTAL row (no quantity) was skipped
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(2844.9, 1);
  });

  it("computes amounts from quantity x rate when the sheet has no amount column", () => {
    const rows: Array<Array<string | number | null>> = [
      ["Product", "Tons", "Rate"],
      ["Pine pulpwood", 20, 10],
      ["Pine pulpwood", 10, 10],
    ];
    const lines = collapseLoads(rows, {
      header_row: 0,
      product: 0,
      quantity: 1,
      rate: 2,
      unit: "ton",
      products: [
        { raw: "Pine pulpwood", product: "pine_pulpwood", label: "Pine pulpwood" },
      ],
    });
    expect(lines[0].amount).toBe(300);
    expect(lines[0].rate).toBe(10);
  });

  it("keeps unmapped product spellings as custom slugs", () => {
    const rows: Array<Array<string | number | null>> = [
      ["Product", "Tons", "Amount"],
      ["Cypress specialty", 12.5, 500],
    ];
    const lines = collapseLoads(rows, {
      header_row: 0,
      product: 0,
      quantity: 1,
      amount: 2,
      unit: "ton",
      products: [],
    });
    expect(lines[0].product).toBe("cypress_specialty");
    expect(lines[0].label).toBe("Cypress specialty");
  });

  it("parses csv input and Excel serial dates", () => {
    const rows = csvToRows("Product,Date,Tons,Amount\nPine pulpwood,3/2/2026,10,95\n");
    expect(rows[1][0]).toBe("Pine pulpwood");
    expect(cellToIsoDate(46083)).toBe("2026-03-02"); // Excel serial
    expect(cellToIsoDate("3/2/2026")).toBe("2026-03-02");
    expect(cellToIsoDate("not a date")).toBeNull();
  });
});

describe("MBF rates and Doyle scale handling", () => {
  it("legacy $/ton rates normalize; MBF rates default to Doyle", () => {
    const legacy = normalizeStumpageRate({
      product: "pine_sawtimber",
      label: "Pine sawtimber",
      price_per_ton: 30,
    });
    expect(legacy.rate).toBe(30);
    expect(legacy.unit).toBe("ton");
    expect(legacy.log_scale).toBeNull();

    const mbf = normalizeStumpageRate({
      product: "hardwood_sawtimber",
      label: "Hardwood sawtimber",
      rate: 350,
      unit: "mbf",
    });
    expect(mbf.unit).toBe("mbf");
    expect(mbf.log_scale).toBe("doyle");
  });

  it("settlements entered in MBF collapse in MBF and pay quantity x rate", () => {
    const rows: Array<Array<string | number | null>> = [
      ["Product", "MBF", "Rate"],
      ["Hardwood sawtimber", 4.25, 350],
      ["Hardwood sawtimber", 3.1, 350],
    ];
    const lines = collapseLoads(rows, {
      header_row: 0,
      product: 0,
      quantity: 1,
      rate: 2,
      unit: "mbf",
      products: [
        {
          raw: "Hardwood sawtimber",
          product: "hardwood_sawtimber",
          label: "Hardwood sawtimber",
        },
      ],
    });
    expect(lines[0].unit).toBe("mbf");
    expect(lines[0].quantity).toBeCloseTo(7.35, 2);
    expect(lines[0].amount).toBeCloseTo(7.35 * 350, 2);
  });

  it("legacy settlement lines (tons/price_per_ton) still read", () => {
    const line = normalizeSettlementLine({
      product: "pine_pulpwood",
      label: "Pine pulpwood",
      tons: 55.5,
      price_per_ton: 9.5,
      amount: 527.25,
    });
    expect(line.quantity).toBe(55.5);
    expect(line.rate).toBe(9.5);
    expect(line.unit).toBe("ton");
  });
});

describe("rateMismatch", () => {
  const contract = [
    normalizeStumpageRate({ product: "pine_sawtimber", label: "Pine sawtimber", rate: 30, unit: "ton" }),
  ];

  it("flags a paid rate that differs from the contract without blocking", () => {
    const m = rateMismatch(
      { product: "pine_sawtimber", label: "", quantity: 10, unit: "ton", rate: 28.5, amount: 285 },
      contract
    );
    expect(m?.contract.rate).toBe(30);
    expect(m?.unitMismatch).toBe(false);
  });

  it("is quiet when the rates agree or the product is not in the contract", () => {
    expect(
      rateMismatch(
        { product: "pine_sawtimber", label: "", quantity: 10, unit: "ton", rate: 30, amount: 300 },
        contract
      )
    ).toBeNull();
    expect(
      rateMismatch(
        { product: "topwood_chips", label: "", quantity: 10, unit: "ton", rate: 5, amount: 50 },
        contract
      )
    ).toBeNull();
  });

  it("different units always flag", () => {
    const m = rateMismatch(
      { product: "pine_sawtimber", label: "", quantity: 4, unit: "mbf", rate: 350, amount: 1400 },
      contract
    );
    expect(m?.unitMismatch).toBe(true);
  });
});
