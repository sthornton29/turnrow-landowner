import { describe, expect, it } from "vitest";
import { printedIdentifier, type StoredIdentifier } from "./taxIdentifiers";
import { aliasToLearn, careOfTarget, identifiersToLearn, matchEntity, matchLine } from "./taxMatch";

const parcels = [
  { id: "p3", parcel_number: "07 09 31 0 000 003.000", property_id: "shop", property_name: "Shop Area" },
  { id: "c1", parcel_number: "11 07 26 0 000 001.000", property_id: "cotton", property_name: "Cottontown" },
  { id: "m1", parcel_number: "02 04 18 0 000 007.005", property_id: "morgan", property_name: "Morgan County" },
];
// What the store holds after the county import mirrored parcel numbers.
const base: StoredIdentifier[] = parcels.map((p) => ({ parcel_id: p.id, kind: "parcel_number", value: p.parcel_number, normalized: normalizedOf(p.parcel_number) }));
function normalizedOf(v: string) {
  return printedIdentifier("x", "parcel_number", v)!.normalized;
}
const ids = (...pairs: Array<[string, string, string]>) => pairs.map(([label, kind, value]) => printedIdentifier(label, kind, value)!);

describe("matchLine", () => {
  it("matches a Morgan statement despite the space format and captures all three numbers", () => {
    const line = { line_type: "real_property", identifiers: ids(["Parcel", "parcel_number", "02-04-18-0-000-007.005"], ["Key Number", "key_number", "55021"], ["Receipt Number", "receipt_number", "2024-118877"]) };
    const m = matchLine(line, base, parcels);
    expect(m.parcelId).toBe("m1");
    expect(m.evidence).toContain("Parcel number 02-04-18-0-000-007.005 matches parcel 02 04 18 0 000 007.005 on Morgan County");
    expect(identifiersToLearn("m1", line.identifiers, base).map((x) => x.kind)).toEqual(["key_number", "receipt_number"]);
  });
  it("does not match a PPIN-only Colbert line until the PPIN is learned, then matches by PPIN", () => {
    const line = { line_type: "real_property", identifiers: ids(["PPIN", "ppin", "44521"]) };
    expect(matchLine(line, base, parcels).parcelId).toBeNull();
    // The user confirms the line by hand: its identifiers save to the parcel.
    const learned = identifiersToLearn("c1", line.identifiers, base);
    expect(learned).toEqual([{ parcel_id: "c1", kind: "ppin", label: "PPIN", value: "44521", normalized: "44521" }]);
    const store = [...base, ...learned.map((l) => ({ parcel_id: l.parcel_id, kind: l.kind, value: l.value, normalized: l.normalized }))];
    // Next year's statement, same county format, matches automatically.
    const next = { line_type: "real_property", identifiers: ids(["PPIN", "ppin", "0044521"]) };
    const m = matchLine(next, store, parcels);
    expect(m.parcelId).toBe("c1");
    expect(m.evidence).toBe("PPIN 0044521 matches parcel 11 07 26 0 000 001.000 on Cottontown");
    expect(identifiersToLearn("c1", next.identifiers, store)).toEqual([]);
  });
  it("falls back to a kind-agnostic match when the county relabels the number", () => {
    const store = [...base, { parcel_id: "c1", kind: "ppin", value: "44521", normalized: "44521" }];
    const line = { line_type: "real_property", identifiers: ids(["Account", "account_number", "44521"]) };
    const m = matchLine(line, store, parcels);
    expect(m.parcelId).toBe("c1");
    expect(m.evidence).toContain("matches the PPIN on parcel");
  });
  it("keeps 013.000 and 001.003 apart (segment boundaries survive the compact key)", () => {
    const two = [
      { id: "a", parcel_number: "07 09 29 0 200 013.000", property_id: "shop", property_name: "Shop Area" },
      { id: "b", parcel_number: "07 09 29 0 200 001.003", property_id: "phin", property_name: "Phinizy" },
    ];
    const store: StoredIdentifier[] = two.map((p) => ({ parcel_id: p.id, kind: "parcel_number", value: p.parcel_number, normalized: normalizedOf(p.parcel_number) }));
    const m = matchLine({ line_type: "real_property", identifiers: ids(["PARCEL", "parcel_number", "07-09-29-0-200-013.000-0"]) }, store, two);
    expect(m.parcelId).toBe("a");
    expect(m.candidates).toHaveLength(1);
  });
  it("never matches personal property, and lists several candidates without choosing", () => {
    expect(matchLine({ line_type: "personal_property", identifiers: ids(["Parcel", "parcel_number", "00-00-00-0-000-000.000"]) }, base, parcels).parcelId).toBeNull();
    const two = matchLine({ line_type: "real_property", identifiers: ids(["Parcel", "parcel_number", "07-09-31-0-000-003.000"], ["Parcel", "parcel_number", "11-07-26-0-000-001.000"]) }, base, parcels);
    expect(two.parcelId).toBeNull();
    expect(two.candidates).toHaveLength(2);
  });
});

describe("matchEntity", () => {
  const entities = [
    { id: "alb", name: "Albemarle Corporation", aliases: ["THE ALBEMARLE CORPORATION"] },
    { id: "pin", name: "Pinnacle Farms LLC", aliases: [] },
  ];
  it("tolerates county typos", () => {
    expect(matchEntity({ taxpayer_name: "THE AMBEMARLE CORPORATION", care_of: null }, entities).entityId).toBe("alb");
    expect(matchEntity({ taxpayer_name: "THE ALBERMALE CORPORATION", care_of: null }, entities).entityId).toBe("alb");
    expect(matchEntity({ taxpayer_name: "THE PEACHTREE CORPORATION", care_of: null }, entities).entityId).toBeNull();
  });
  it("uses the C/O target as the signal and keeps the taxpayer as printed", () => {
    expect(careOfTarget("MARTIN L SYKES C/O ALBEMARLE CORP", null)).toBe("ALBEMARLE CORP");
    const m = matchEntity({ taxpayer_name: "MARTIN L SYKES C/O ALBEMARLE CORP", care_of: null }, entities);
    expect(m.entityId).toBe("alb");
    expect(m.comparedName).toBe("ALBEMARLE CORP");
    expect(m.evidence).toContain("ALBEMARLE CORP");
  });
  it("learns the printed variant as an alias only when new", () => {
    expect(aliasToLearn("THE AMBEMARLE CORPORATION", entities[0])).toBe("THE AMBEMARLE CORPORATION");
    expect(aliasToLearn("ALBEMARLE CORP", entities[0])).toBeNull();
    expect(aliasToLearn(null, entities[0])).toBeNull();
  });
});
