// The universal identifier system for property tax matching. Counties
// across the country key statements on different numbers (parcel
// number, PPIN, account, key, receipt, folio, schedule, SBL, ...). One
// parcel can carry any number of them; all are stored in
// parcel_identifiers as printed and normalized (lib/parcelNumber.ts),
// and matching tries kind-aware first, then kind-agnostic. Pure; unit
// tested in taxIdentifiers.test.ts.

import { canonicalParcel, parcelKey } from "@/lib/parcelNumber";

export const IDENTIFIER_KINDS = [
  "parcel_number",
  "apn",
  "pin",
  "ppin",
  "account_number",
  "key_number",
  "receipt_number",
  "property_id",
  "geo_id",
  "folio",
  "alt_key",
  "schedule_number",
  "duplicate_number",
  "bill_number",
  "sbl",
  "bbl",
  "tmk",
  "assessment_number",
  "control_map",
  "upc",
  "other",
] as const;

export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

export const IDENTIFIER_KIND_LABELS: Record<IdentifierKind, string> = {
  parcel_number: "Parcel number",
  apn: "APN",
  pin: "PIN",
  ppin: "PPIN",
  account_number: "Account number",
  key_number: "Key number",
  receipt_number: "Receipt number",
  property_id: "Property ID",
  geo_id: "Geo ID",
  folio: "Folio",
  alt_key: "Alternate key",
  schedule_number: "Schedule number",
  duplicate_number: "Duplicate number",
  bill_number: "Bill number",
  sbl: "Section-block-lot",
  bbl: "Borough-block-lot",
  tmk: "TMK",
  assessment_number: "Assessment number",
  control_map: "Control map",
  upc: "UPC",
  other: "Other",
};

// A printed identifier: label as printed, best-guess kind, value as
// printed, normalized form for matching.
export interface PrintedIdentifier {
  label: string | null;
  kind: IdentifierKind;
  value: string;
  normalized: string;
}

export interface StoredIdentifier {
  parcel_id: string;
  kind: IdentifierKind | string;
  value: string;
  normalized: string;
}

export function normalizeIdentifier(value: string | null | undefined): string {
  return canonicalParcel(value);
}

// Equal RAW values: the dashed canonical forms agree, or the compact
// keys of the raw printings do (a run-together printing against a
// punctuated one). Only ever pass values AS PRINTED here: the compact
// key of an already zero-stripped canonical string loses segment
// boundaries ("7-9-29-0-200-13" and "7-9-29-0-200-1-3" would both read
// 7929020013), which is what sameIdentifier guards against.
export function identifiersEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalParcel(a);
  const ka = parcelKey(a);
  return (ca !== "" && ca === canonicalParcel(b)) || (ka !== "" && ka === parcelKey(b));
}

// Equal stored/printed identifiers: canonical forms agree, or the
// compact keys of the raw values agree.
export function sameIdentifier(
  a: { value: string; normalized: string },
  b: { value: string; normalized: string }
): boolean {
  if (a.normalized !== "" && a.normalized === b.normalized) return true;
  const ka = parcelKey(a.value);
  return ka !== "" && ka === parcelKey(b.value);
}

// Label (as printed on paper or as a GIS field name) -> kind. Order
// matters: the more specific patterns come first.
const KIND_PATTERNS: Array<{ kind: IdentifierKind; re: RegExp }> = [
  { kind: "ppin", re: /\bppin\b|^ppin/i },
  { kind: "apn", re: /\bapn\b|assessor'?s? parcel/i },
  { kind: "account_number", re: /\bacc(?:oun)?t\b|\baccount\b|acct ?(?:no|num|#)/i },
  { kind: "receipt_number", re: /\breceipt\b|\brcpt\b/i },
  { kind: "alt_key", re: /\balt(?:ernate)? ?key\b|\baltkey\b/i },
  { kind: "key_number", re: /\bkey\b/i },
  { kind: "bill_number", re: /\bbill\b/i },
  { kind: "geo_id", re: /\bgeo ?id\b|\bgeographic id\b/i },
  { kind: "property_id", re: /\bprop(?:erty)? ?id\b|\bprop ?#/i },
  { kind: "folio", re: /\bfolio\b/i },
  { kind: "schedule_number", re: /\bschedule\b|\bsched\b/i },
  { kind: "duplicate_number", re: /\bduplicate\b|\bdup(?:l)? ?(?:no|num|#)/i },
  { kind: "sbl", re: /\bs\.?b\.?l\.?\b|section.?block.?lot/i },
  { kind: "bbl", re: /\bb\.?b\.?l\.?\b|borough.?block.?lot/i },
  { kind: "tmk", re: /\btmk\b|tax map key/i },
  { kind: "assessment_number", re: /\bassessment (?:no|num|number|#)/i },
  { kind: "control_map", re: /\bcontrol ?map\b|\bctrl ?map\b/i },
  { kind: "upc", re: /\bupc\b|uniform property code/i },
  { kind: "pin", re: /\bpin\b|^pin_?(?:no|num)?$/i },
  { kind: "parcel_number", re: /\bparcel\b|\bparid\b|\bpar ?(?:no|num|id)\b|^parcel_?(?:id|no|num)/i },
];

export function guessKind(label: string | null | undefined): IdentifierKind {
  const l = (label ?? "").trim();
  if (!l) return "other";
  for (const p of KIND_PATTERNS) if (p.re.test(l)) return p.kind;
  return "other";
}

// Accept a kind from the AI when it is one of ours, else guess from the label.
export function coerceKind(kind: unknown, label: string | null | undefined): IdentifierKind {
  const k = String(kind ?? "").trim().toLowerCase() as IdentifierKind;
  if ((IDENTIFIER_KINDS as readonly string[]).includes(k) && k !== "other") return k;
  return guessKind(label);
}

export function printedIdentifier(
  label: string | null | undefined,
  kind: unknown,
  value: string | null | undefined
): PrintedIdentifier | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const normalized = normalizeIdentifier(v);
  if (!normalized) return null;
  return { label: label ? String(label).trim() || null : null, kind: coerceKind(kind, label), value: v, normalized };
}

// ---------------------------------------------------------------- county attributes

// GIS attribute names that are identifiers worth keeping, by kind. The
// pattern list is the same one the labels use, plus field-name habits.
const ATTRIBUTE_SKIP = /acre|area|shape|objectid|globalid|length|perimeter|owner|addr|situs|value|tax|year|date|zip|city|state|legal|desc|name|phone|class|use|zone|exempt|district|mail/i;

export function harvestIdentifiers(
  attrs: Record<string, unknown> | null | undefined,
  opts: { parcelField?: string | null } = {}
): PrintedIdentifier[] {
  if (!attrs) return [];
  const out: PrintedIdentifier[] = [];
  const seen = new Set<string>();
  for (const [field, raw] of Object.entries(attrs)) {
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (!value || value.length > 40) continue;
    // Identifiers are mostly digits with separators; skip prose.
    if (!/\d/.test(value) || /\s[a-z]{3,}\s/i.test(value)) continue;
    let kind: IdentifierKind;
    if (opts.parcelField && field === opts.parcelField) kind = "parcel_number";
    else {
      if (ATTRIBUTE_SKIP.test(field) && !/ppin|pin|apn|parcel|account|folio|key|receipt|schedule|duplicate|bill|sbl|bbl|tmk|upc|geo/i.test(field)) continue;
      kind = guessKind(field);
      if (kind === "other") continue;
    }
    const normalized = normalizeIdentifier(value);
    if (!normalized) continue;
    const k = `${kind}|${normalized}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label: field, kind, value, normalized });
  }
  return out;
}
