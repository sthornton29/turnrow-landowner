import { describe, expect, it } from "vitest";
import { printedIdentifier, type StoredIdentifier } from "./taxIdentifiers";
import { aliasToLearn, careOfTarget, identifiersToLearn, matchEntity, matchLine, matchLineViaCounty, sameParcelNumber } from "./taxMatch";

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

describe("matchLineViaCounty (the live county lookup tier)", () => {
  const svc = { service_label: "Colbert County GIS", service_id: "svc-colbert" };
  const cottontown = [
    { id: "c000", parcel_number: "11 07 26 0 000 001.000", property_id: "cot", property_name: "Cottontown" },
    { id: "c001", parcel_number: "11 07 26 0 000 001.001", property_id: "cot", property_name: "Cottontown" },
  ];
  // The two Colbert records as the county returned them on 2026-09-08.
  const hit2471 = {
    kind: "ppin" as const,
    value: "2471",
    parcel_number: "11 07 26 0 000 001.001",
    ...svc,
    identifiers: ids(["PPIN", "ppin", "2471"], ["PIN", "pin", "2471"], ["PARCEL_NO", "parcel_number", "1107260000001001"]),
    attributes: { PPIN: 2471, PIN: "2471", Owner: "ALBEMARLE CORP/ THE" },
    overlaps: [{ parcel_id: "c001", share: 0.99 }],
  };
  it("resolves a printed PPIN through the county to the parcel by parcel number", () => {
    const m = matchLineViaCounty({ line_type: "real_property" }, [hit2471], cottontown);
    expect(m.parcelId).toBe("c001");
    expect(m.source).toBe("identifier");
    expect(m.evidence).toBe("PPIN 2471 resolved via Colbert County GIS to parcel 11 07 26 0 000 001.001 on Cottontown");
    expect(m.learn.map((i) => i.kind)).toEqual(["ppin", "pin", "parcel_number"]);
    expect(m.serviceId).toBe("svc-colbert");
    expect(m.notInAccount).toEqual([]);
  });
  it("falls back to spatial overlap when the county records the number differently", () => {
    // Neither the parcel field nor a harvested parcel number matches; only the boundary does.
    const hit = { ...hit2471, parcel_number: "99-99-99", identifiers: hit2471.identifiers.filter((i) => i.kind !== "parcel_number") };
    const m = matchLineViaCounty({ line_type: "real_property" }, [hit], cottontown);
    expect(m.parcelId).toBe("c001");
    expect(m.source).toBe("spatial");
    expect(m.evidence).toContain("99% inside parcel 11 07 26 0 000 001.001 on Cottontown");
  });
  it("offers an import when the county's parcel is not in the account, and never matches it", () => {
    const hit = { ...hit2471, parcel_number: "11 07 26 0 000 001.002", identifiers: hit2471.identifiers.filter((i) => i.kind !== "parcel_number"), overlaps: [{ parcel_id: "c000", share: 0.02 }] };
    const m = matchLineViaCounty({ line_type: "real_property" }, [hit], cottontown);
    expect(m.parcelId).toBeNull();
    expect(m.notInAccount).toEqual([{ value: "2471", kind: "ppin", parcel_number: "11 07 26 0 000 001.002", service_id: "svc-colbert", service_label: "Colbert County GIS" }]);
  });
  it("lists several parcels without choosing, and never matches personal property", () => {
    const other = { ...hit2471, value: "2661", parcel_number: "11 07 26 0 000 001.000", overlaps: [] };
    const m = matchLineViaCounty({ line_type: "real_property" }, [hit2471, other], cottontown);
    expect(m.parcelId).toBeNull();
    expect(m.candidates).toHaveLength(2);
    expect(matchLineViaCounty({ line_type: "personal_property" }, [hit2471], cottontown).parcelId).toBeNull();
  });
});

describe("account numbers are weak identifiers", () => {
  it("a per-line account number never outvotes the PPIN, but still matches alone", () => {
    const store: StoredIdentifier[] = [
      ...base,
      { parcel_id: "c1", kind: "ppin", value: "2661", normalized: "2661" },
      { parcel_id: "c1", kind: "account_number", value: "1234", normalized: "1234" },
      { parcel_id: "p3", kind: "account_number", value: "1234", normalized: "1234" },
    ];
    const both = matchLine({ line_type: "real_property", identifiers: ids(["PPIN", "ppin", "2661"], ["Account", "account_number", "1234"]) }, store, parcels);
    expect(both.parcelId).toBe("c1");
    expect(both.evidence).toMatch(/^PPIN 2661/);
    const alone = matchLine({ line_type: "real_property", identifiers: ids(["Account", "account_number", "1234"]) }, store, parcels);
    expect(alone.parcelId).toBeNull();
    expect(alone.candidates).toHaveLength(2);
  });
});

describe("county tier: compact spellings and weak account hits", () => {
  it("equates a county's run-together number with a trailing zero sub-parcel to the spaced spelling", () => {
    expect(sameParcelNumber("11 07 26 0 000 001.000", "1107260000001000")).toBe(true);
    expect(sameParcelNumber("11 07 26 0 000 001.001", "1107260000001001")).toBe(true);
    expect(sameParcelNumber("11 07 26 0 000 001.000", "1107260000001001")).toBe(false);
    expect(sameParcelNumber("11 07 26 0 000 001", "11072600000010001")).toBe(false);
  });
  it("lets a PPIN hit decide over account hits on every parcel of the bill", () => {
    const two = [
      { id: "a", parcel_number: "11 07 26 0 000 001.000", property_id: "cot", property_name: "Cottontown" },
      { id: "b", parcel_number: "11 07 26 0 000 001.001", property_id: "cot", property_name: "Cottontown" },
    ];
    const hit = (kind: "ppin" | "account_number", value: string, parcel_number: string) => ({ kind, value, parcel_number, service_label: "Colbert County GIS", service_id: "svc", identifiers: [], attributes: {}, overlaps: [] });
    const m = matchLineViaCounty({ line_type: "real_property" }, [hit("account_number", "1234", "1107260000001000"), hit("account_number", "1234", "1107260000001001"), hit("ppin", "2471", "1107260000001001")], two);
    expect(m.parcelId).toBe("b");
    expect(m.evidence).toMatch(/^PPIN 2471/);
    const alone = matchLineViaCounty({ line_type: "real_property" }, [hit("account_number", "1234", "1107260000001000"), hit("account_number", "1234", "1107260000001001")], two);
    expect(alone.parcelId).toBeNull();
    expect(alone.candidates).toHaveLength(2);
  });
});
