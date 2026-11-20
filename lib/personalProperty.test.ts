import { describe, expect, it } from "vitest";
import {
  isPersonalPropertyStatement,
  labelForAccount,
  personalPropertyAccounts,
  statementsToRelabel,
  taxAccountKey,
  type PersonalPropertyLine,
  type PersonalPropertyStatement,
} from "@/lib/personalProperty";

const stmt = (id: string, year: number, over: Partial<PersonalPropertyStatement> = {}): PersonalPropertyStatement => ({
  id,
  tax_year: year,
  county: "Lawrence",
  account_number: "14620",
  account_kind: "account_number",
  taxpayer_name_printed: "ALBEMARLE CORP",
  entity_id: "e1",
  label: null,
  ...over,
});
const pp = (statementId: string, year: number, tax: number, appraised: number | null = null): PersonalPropertyLine => ({
  tax_statement_id: statementId,
  tax_year: year,
  line_type: "personal_property",
  tax_due: tax,
  appraised_value: appraised,
});

describe("what counts as a personal property bill", () => {
  it("is a statement whose every line is personal property", () => {
    expect(isPersonalPropertyStatement([{ line_type: "personal_property" }])).toBe(true);
    expect(isPersonalPropertyStatement([{ line_type: "personal_property" }, { line_type: "real_property" }])).toBe(false);
    // A postcard bill with no lines says nothing about what it covers.
    expect(isPersonalPropertyStatement([])).toBe(false);
  });
});

describe("one county account, however it was printed", () => {
  it("ignores the word County, letter case, and leading zeros", () => {
    expect(taxAccountKey({ county: "Lawrence", account_number: "14620" })).toBe(taxAccountKey({ county: "LAWRENCE COUNTY ", account_number: "014620" }));
    expect(taxAccountKey({ county: "Colbert", account_number: "001234" })).toBe(taxAccountKey({ county: "colbert", account_number: "1234" }));
    expect(taxAccountKey({ county: "Lawrence", account_number: "14620" })).not.toBe(taxAccountKey({ county: "Morgan", account_number: "14620" }));
  });

  it("has no key without an account number or a county", () => {
    expect(taxAccountKey({ county: "Lawrence", account_number: null })).toBeNull();
    expect(taxAccountKey({ county: null, account_number: "14620" })).toBeNull();
  });
});

describe("the label an account carries", () => {
  const statements = [
    stmt("a", 2024, { label: "Office contents" }),
    stmt("b", 2025, { label: "Contents within business" }),
    stmt("c", 2026),
    stmt("d", 2025, { account_number: "8080", label: "Home farm" }),
  ];

  it("is the newest label on that account, for next year's bill", () => {
    expect(labelForAccount(statements, { county: "Lawrence County", account_number: "014620" })).toBe("Contents within business");
    expect(labelForAccount(statements, { county: "Lawrence", account_number: "8080" })).toBe("Home farm");
  });

  it("is nothing for an account never labeled, or a bill with no account", () => {
    expect(labelForAccount(statements, { county: "Lawrence", account_number: "999" })).toBeNull();
    expect(labelForAccount(statements, { county: "Lawrence", account_number: null })).toBeNull();
  });

  it("is written to every other year of the account that does not have it yet", () => {
    expect(statementsToRelabel(statements, statements[2], "Contents within business")).toEqual(["a"]);
    // Clearing the label clears it on the labeled years.
    expect(statementsToRelabel(statements, statements[2], null).sort()).toEqual(["a", "b"]);
    // A bill with no account number changes only itself.
    expect(statementsToRelabel(statements, { id: "x", county: "Lawrence", account_number: null }, "Anything")).toEqual([]);
  });
});

describe("personal property accounts for a tax year", () => {
  const statements = [stmt("s24", 2024), stmt("s25", 2025, { label: "Contents within business" }), stmt("s26", 2026)];
  const lines = [pp("s24", 2024, 91.65, 19513), pp("s25", 2025, 78.49, 16729), pp("s26", 2026, 36.19, 7651)];

  it("shows this year beside the last year billed", () => {
    const rows = personalPropertyAccounts(statements, lines, 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      account_number: "14620",
      label: "Contents within business", // from the account's earlier statement
      statementId: "s26",
      tax: 36.19,
      appraised: 7651,
      priorYear: 2025,
      priorTax: 78.49,
      priorAppraised: 16729,
      missing: false,
    });
  });

  it("flags the account billed last year with nothing on file this year", () => {
    const rows = personalPropertyAccounts(statements.slice(0, 2), lines.slice(0, 2), 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ missing: true, statementId: null, tax: null, priorYear: 2025, priorTax: 78.49, entity_id: "e1" });
  });

  it("stops asking once a year has gone by without one", () => {
    // Billed in 2024 only: expected in 2025, not still expected in 2026.
    expect(personalPropertyAccounts(statements.slice(0, 1), lines.slice(0, 1), 2025)[0]?.missing).toBe(true);
    expect(personalPropertyAccounts(statements.slice(0, 1), lines.slice(0, 1), 2026)).toEqual([]);
  });

  it("never counts land: real property lines are not part of it", () => {
    const land = { tax_statement_id: "s26", tax_year: 2026, line_type: "real_property", tax_due: 500, appraised_value: 90000 };
    const rows = personalPropertyAccounts(statements, [...lines, land], 2026);
    expect(rows[0].tax).toBe(36.19);
    expect(personalPropertyAccounts(statements, [land], 2026)).toEqual([]);
  });

  it("adds up several personal property lines on one account, and keeps a missing value missing", () => {
    const rows = personalPropertyAccounts([stmt("s26", 2026)], [pp("s26", 2026, 10, 1000), pp("s26", 2026, 5.5, null)], 2026);
    expect(rows[0]).toMatchObject({ tax: 15.5, appraised: 1000 });
    expect(personalPropertyAccounts([stmt("s26", 2026)], [pp("s26", 2026, 10)], 2026)[0].appraised).toBeNull();
  });

  it("keeps a bill with no account number in its own year without ever calling it missing", () => {
    const noAccount = [stmt("n25", 2025, { account_number: null })];
    expect(personalPropertyAccounts(noAccount, [pp("n25", 2025, 20)], 2025)).toHaveLength(1);
    expect(personalPropertyAccounts(noAccount, [pp("n25", 2025, 20)], 2026)).toEqual([]);
  });

  it("lists the bills still to come in first", () => {
    const two = [...statements.slice(0, 2), stmt("o26", 2026, { account_number: "777", label: "Shop equipment" })];
    const rows = personalPropertyAccounts(two, [...lines.slice(0, 2), pp("o26", 2026, 12)], 2026);
    expect(rows.map((r) => [r.account_number, r.missing])).toEqual([
      ["14620", true],
      ["777", false],
    ]);
  });
});
