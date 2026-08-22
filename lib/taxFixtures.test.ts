// The three REAL 2024 Alabama statements (Lawrence, Colbert, Morgan) are
// the regression suite for the property tax rebuild. This suite runs on
// the snapshots that taxFixtures.live.test.ts wrote (no API calls) and
// checks the whole pipeline after extraction: segmentation, header and
// line shapes, reconciliation, identifier capture, matching, learning,
// and entity matching with the county's typos. Skips until the PDFs and
// their snapshots exist in fixtures/tax-statements.
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { groupPages, reconcile, type PageHeader } from "@/lib/taxSegment";
import { printedIdentifier, type StoredIdentifier } from "@/lib/taxIdentifiers";
import { identifiersToLearn, matchEntity, matchLine } from "@/lib/taxMatch";

const DIR = path.join(process.cwd(), "fixtures", "tax-statements");

interface Snapshot {
  file: string;
  total_pages: number;
  pages: PageHeader[];
  groups: ReturnType<typeof groupPages>;
  statements: Array<{ pages: number[]; extraction: Record<string, unknown> }>;
}

function load(name: string): Snapshot | null {
  const p = path.join(DIR, `${name}.expected.json`);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Snapshot) : null;
}

type RawLine = {
  line_type: string;
  identifiers: Array<{ label: string; kind: string; value: string }>;
  tax_due: number | null;
  legal_description: string | null;
};

function linesOf(s: Snapshot["statements"][number]): Array<{ line_type: "real_property" | "personal_property"; identifiers: NonNullable<ReturnType<typeof printedIdentifier>>[]; tax_due: number | null; legal_description: string | null }> {
  return ((s.extraction.lines as RawLine[]) ?? []).map((l) => ({
    line_type: l.line_type === "personal_property" ? "personal_property" : "real_property",
    identifiers: l.identifiers.map((i) => printedIdentifier(i.label, i.kind, i.value)).filter((x): x is NonNullable<typeof x> => x !== null),
    tax_due: l.tax_due,
    legal_description: l.legal_description,
  }));
}

const lawrence = load("2024-lawrence");
const colbert = load("2024-colbert");
const morgan = load("2024-morgan");

const entities = [
  { id: "alb", name: "Albemarle Corporation", aliases: ["THE ALBEMARLE CORPORATION"] },
];

describe.skipIf(!lawrence)("Lawrence County 2024 (whole-account statement)", () => {
  it("groups the multi-page account as ONE statement", () => {
    const s = lawrence!;
    const groups = groupPages(s.pages);
    const big = groups.reduce((a, g) => (g.pages.length > a.pages.length ? g : a), groups[0]);
    expect(big.pages.length).toBeGreaterThanOrEqual(Math.max(2, s.total_pages - 1));
    expect(big.billing_kind).toBe("account_number");
  });
  it("reads several parcel lines that reconcile to the printed total", () => {
    const s = lawrence!;
    const st = s.statements.reduce((a, b) => (b.pages.length > a.pages.length ? b : a), s.statements[0]);
    const lines = linesOf(st);
    expect(lines.length).toBeGreaterThan(4);
    const r = reconcile(lines.map((l) => l.tax_due), st.extraction.total_tax as number);
    expect(r.reconciled, `gap ${r.gap}`).toBe(true);
  });
  it("matches the typo'd taxpayer to the entity and keeps a personal property line parcel-free", () => {
    const s = lawrence!;
    for (const st of s.statements) {
      const name = st.extraction.taxpayer_name as string | null;
      if (name && /A[LM]BE/i.test(name)) {
        const m = matchEntity({ taxpayer_name: name, care_of: (st.extraction.care_of as string) ?? null }, entities);
        expect(m.entityId, name).toBe("alb");
      }
      for (const l of linesOf(st)) {
        if (l.line_type === "personal_property") {
          expect(matchLine(l, [], []).parcelId).toBeNull();
        }
      }
    }
  });
});

describe.skipIf(!colbert)("Colbert County 2024 (account 1234, PPIN only)", () => {
  it("reads the account header and two PPIN lines that reconcile", () => {
    const s = colbert!;
    expect(s.statements).toHaveLength(1);
    const st = s.statements[0];
    expect(printedIdentifier("Account", "account_number", st.extraction.billing_key as string)?.normalized).toBe("1234");
    expect(st.extraction.total_tax).toBe(510.1);
    const lines = linesOf(st);
    expect(lines.map((l) => [l.identifiers.find((i) => i.kind === "ppin")?.normalized, l.tax_due])).toEqual([
      ["2471", 69],
      ["2661", 441.1],
    ]);
    expect(reconcile(lines.map((l) => l.tax_due), st.extraction.total_tax as number).reconciled).toBe(true);
    expect(matchEntity({ taxpayer_name: st.extraction.taxpayer_name as string, care_of: null }, entities).entityId).toBe("alb");
  });
  it("captures PPINs and matches only after the PPIN is learned", () => {
    const s = colbert!;
    const lines = s.statements.flatMap(linesOf).filter((l) => l.line_type === "real_property");
    expect(lines.length).toBeGreaterThan(0);
    const ppins = lines.flatMap((l) => l.identifiers.filter((i) => i.kind === "ppin"));
    expect(ppins.length, "no PPIN identifiers captured").toBeGreaterThan(0);
    const parcels = [{ id: "c1", parcel_number: "11 07 26 0 000 001.000", property_id: "cot", property_name: "Cottontown" }];
    const stored: StoredIdentifier[] = [{ parcel_id: "c1", kind: "parcel_number", value: parcels[0].parcel_number, normalized: "11-7-26-0-0-1" }];
    const first = lines[0];
    // First year: nothing matches a PPIN-only line.
    expect(matchLine(first, stored, parcels).parcelId).toBeNull();
    // Confirm by hand: the PPIN saves to the parcel.
    const learned = identifiersToLearn("c1", first.identifiers, stored);
    expect(learned.some((l) => l.kind === "ppin")).toBe(true);
    const store2 = [...stored, ...learned];
    // Next year, same paper: matches on the learned PPIN.
    const m = matchLine(first, store2, parcels);
    expect(m.parcelId).toBe("c1");
    expect(m.evidence).toMatch(/^PPIN /);
  });
});

describe.skipIf(!morgan)("Morgan County 2024 (two single-parcel statements in one file)", () => {
  it("segments the two receipts as two statements with one line each", () => {
    const s = morgan!;
    expect(s.total_pages).toBe(2);
    expect(s.groups).toHaveLength(2);
    expect(s.groups.map((g) => g.pages)).toEqual([[1], [2]]);
    for (const st of s.statements) expect(linesOf(st)).toHaveLength(1);
  });
  it("captures the parcel, key, and receipt numbers and matches despite the space format", () => {
    const s = morgan!;
    const expected = [
      { parcel: "02 04 20 0 002 002.000", key: "678", receipt: "48042", total: 150.86 },
      { parcel: "02 05 21 0 200 013.003", key: "1066", receipt: "47675", total: 70.3 },
    ];
    for (const [i, st] of s.statements.entries()) {
      const lines = linesOf(st);
      const header = ((st.extraction.header_identifiers as Array<{ label: string; kind: string; value: string }>) ?? [])
        .map((h) => printedIdentifier(h.label, h.kind, h.value))
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const all = [...lines[0].identifiers, ...header];
      const byKind = (k: string) => all.find((x) => x.kind === k)?.normalized;
      expect(byKind("parcel_number"), "parcel").toBe(printedIdentifier("x", "parcel_number", expected[i].parcel)!.normalized);
      expect(byKind("key_number"), "key").toBe(expected[i].key);
      expect(byKind("receipt_number"), "receipt").toBe(expected[i].receipt);
      expect(st.extraction.total_tax).toBe(expected[i].total);
      expect(lines[0].tax_due).toBe(expected[i].total);
      // Stored with spaces (county GIS style), printed with spaces too: equal either way.
      const parcels = [{ id: "m1", parcel_number: expected[i].parcel, property_id: "mor", property_name: "Morgan County" }];
      const stored: StoredIdentifier[] = [{ parcel_id: "m1", kind: "parcel_number", value: expected[i].parcel, normalized: printedIdentifier("x", "parcel_number", expected[i].parcel)!.normalized }];
      expect(matchLine(lines[0], stored, parcels).parcelId).toBe("m1");
      expect(matchEntity({ taxpayer_name: st.extraction.taxpayer_name as string, care_of: null }, entities).entityId).toBe("alb");
    }
  });
});

describe.skipIf(!lawrence && !colbert && !morgan)("all fixtures", () => {
  it("reads dates: due Oct 1, delinquent Jan 1 (Lawrence) or Jan 1 after Dec 31 (Colbert, Morgan)", () => {
    for (const s of [lawrence, colbert, morgan]) {
      if (!s) continue;
      for (const st of s.statements) {
        const due = st.extraction.due_date as string | null;
        const del = st.extraction.delinquent_date as string | null;
        if (due) expect(due).toMatch(/^2024-10-01$/);
        if (del) expect(del).toMatch(/^2025-01-01$/);
      }
    }
  });
});
