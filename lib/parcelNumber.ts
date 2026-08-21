// One canonical form for parcel numbers, shared by the tax statement
// matcher, the document matcher, lease land, and the county import.
//
// Alabama PPINs are printed many ways for the same parcel:
//   07 09 31 0 000 003.000        (county GIS, stored)
//   07-09-31-0-000-003.000        (deeds)
//   07-09-31-0-000-003.000-0      (tax statements, with a sub-parcel 0)
//   07-09-31-0-000-003            (shorthand)
// Segments are split on any punctuation or space, leading zeros are
// dropped within a segment, and TRAILING ZERO-ONLY SEGMENTS are dropped
// (they carry no identity: ".000" and "-0" both mean "no sub-parcel").
// A non-zero suffix (003.001) stays distinct from 003.000.

function rawSegments(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const parts = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "-").split("-").filter(Boolean);
  // Trailing zero-only segments carry no identity.
  while (parts.length > 1 && /^0+$/.test(parts[parts.length - 1])) parts.pop();
  return parts;
}

export function parcelSegments(raw: string | null | undefined): string[] {
  return rawSegments(raw).map((part) => (/^\d+$/.test(part) ? String(Number(part)) : part));
}

// Dashed canonical form, e.g. "7-9-31-0-0-3" (leading zeros dropped).
export function canonicalParcel(raw: string | null | undefined): string {
  return parcelSegments(raw).join("-");
}

// Compact key for sets and maps: the digits run together with leading
// zeros KEPT, so a statement that prints the PPIN without separators
// ("120307 0 000 004.000") still equals the dashed form.
export function parcelKey(raw: string | null | undefined): string {
  return rawSegments(raw).join("");
}

// Equal under either form: the compact key (run-together printings) or
// the dashed canonical form (unpadded shorthand).
export function parcelsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = parcelKey(a);
  const ca = canonicalParcel(a);
  return (ka !== "" && ka === parcelKey(b)) || (ca !== "" && ca === canonicalParcel(b));
}
