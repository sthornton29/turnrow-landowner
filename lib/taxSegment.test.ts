import { describe, expect, it } from "vitest";
import { groupPages, reconcile, type PageHeader } from "./taxSegment";

const page = (p: Partial<PageHeader> & { page: number }): PageHeader => ({
  county: "Lawrence",
  state: "AL",
  billing_key: null,
  billing_kind: null,
  taxpayer_name: null,
  tax_year: 2024,
  total_tax: null,
  is_continuation: false,
  is_statement: true,
  ...p,
});

describe("groupPages", () => {
  it("groups a ten-page whole-account bill as ONE statement", () => {
    const headers = Array.from({ length: 10 }, (_, i) =>
      page({
        page: i + 1,
        billing_key: i % 2 ? "000123456" : "123456",
        billing_kind: "account_number",
        taxpayer_name: "THE ALBEMARLE CORPORATION",
        total_tax: 18432.17,
        is_continuation: i > 0,
      })
    );
    const g = groupPages(headers);
    expect(g).toHaveLength(1);
    expect(g[0].pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(g[0].total_tax).toBe(18432.17);
  });
  it("separates single-parcel statements and skips non-statement pages", () => {
    const g = groupPages([
      page({ page: 1, is_statement: false }),
      page({ page: 2, county: "Colbert", billing_key: "PPIN 44521", billing_kind: "other", total_tax: 120 }),
      page({ page: 3, county: "Morgan", billing_key: "R-2024-0099", billing_kind: "receipt_number", total_tax: 310.5 }),
      page({ page: 4, county: "Morgan", billing_key: "R-2024-0099", billing_kind: "receipt_number", is_continuation: true }),
    ]);
    expect(g.map((x) => [x.county, x.pages])).toEqual([
      ["Colbert", [2]],
      ["Morgan", [3, 4]],
    ]);
  });
  it("attaches an unkeyed continuation page to the page before it", () => {
    const g = groupPages([
      page({ page: 1, billing_key: "55", billing_kind: "account_number" }),
      page({ page: 2, is_continuation: true }),
      page({ page: 3, billing_key: "56", billing_kind: "account_number" }),
    ]);
    expect(g.map((x) => x.pages)).toEqual([[1, 2], [3]]);
  });
  it("pre-labels the entity from the account registry", () => {
    const g = groupPages(
      [page({ page: 1, billing_key: "000123456", billing_kind: "account_number", taxpayer_name: "THE AMBEMARLE CORPORATION" })],
      [{ county: "Lawrence", state: "AL", account_number: "123456", entity_id: "e1", entity_name: "Albemarle Corporation" }]
    );
    expect(g[0].entity_id).toBe("e1");
    expect(g[0].entity_evidence).toContain("registered to Albemarle Corporation");
  });
});

describe("reconcile", () => {
  it("accepts a one-cent gap and flags more", () => {
    expect(reconcile([100, 200], 300)).toMatchObject({ reconciled: true, gap: 0 });
    expect(reconcile([100, 200.005], 300)).toMatchObject({ reconciled: true });
    expect(reconcile([100, 200], 300.01)).toMatchObject({ reconciled: true });
    expect(reconcile([100, 200], 301)).toMatchObject({ reconciled: false, gap: 1 });
    expect(reconcile([100], null)).toMatchObject({ reconciled: false, gap: null });
  });
});
