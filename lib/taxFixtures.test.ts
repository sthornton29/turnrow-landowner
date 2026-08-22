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

describe.skipIf(!colbert)("Colbert County 2024 (PPIN only)", () => {
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

describe.skipIf(!morgan)("Morgan County 2024 (single parcel with key and receipt)", () => {
  it("captures the parcel, key, and receipt numbers and matches despite the space format", () => {
    const s = morgan!;
    const st = s.statements[0];
    const lines = linesOf(st);
    expect(lines).toHaveLength(1);
    const header = ((st.extraction.header_identifiers as Array<{ label: string; kind: string; value: string }>) ?? []).map((i) => printedIdentifier(i.label, i.kind, i.value)).filter(Boolean);
    const kinds = new Set([...lines[0].identifiers, ...(header as NonNullable<ReturnType<typeof printedIdentifier>>[])].map((i) => i.kind));
    expect(kinds.has("parcel_number")).toBe(true);
    expect(kinds.has("key_number")).toBe(true);
    expect(kinds.has("receipt_number")).toBe(true);
    const printedParcel = lines[0].identifiers.find((i) => i.kind === "parcel_number")!;
    const spaced = printedParcel.value.replace(/[-.]/g, " ");
    const parcels = [{ id: "m1", parcel_number: spaced, property_id: "mor", property_name: "Morgan County" }];
    const stored: StoredIdentifier[] = [{ parcel_id: "m1", kind: "parcel_number", value: spaced, normalized: printedIdentifier("x", "parcel_number", spaced)!.normalized }];
    expect(matchLine(lines[0], stored, parcels).parcelId).toBe("m1");
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
