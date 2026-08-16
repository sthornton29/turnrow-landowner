// Match land descriptions extracted from a lease document against the
// org's properties. Leases identify land by FSA farm/tract numbers, tax
// parcel numbers, farm names, county, and acreage; the strong
// identifiers win and the soft ones support. Deterministic and pure;
// unit tests in leaseLand.test.ts. Suggestions only: the user confirms
// every link on the review form before anything saves.

import { normalizeParcelNumber } from "@/lib/tax";

export interface ExtractedLeaseLand {
  description: string;
  acres: number | null;
  county: string | null;
  state: string | null;
  fsa_numbers: string[];
  parcel_numbers: string[];
}

export interface MatchableProperty {
  id: string;
  name: string;
  county: string | null;
  acres: number | null;
  fsa_numbers: string[] | null;
}

export interface MatchableParcel {
  property_id: string;
  parcel_number: string;
}

export interface LeaseLandMatch {
  propertyId: string | null;
  // strong = identifier match (FSA or parcel number); soft matches are
  // name/county/acres circumstantial evidence.
  strong: boolean;
}

// FSA numbers are numeric; leases print them as "FSA #1234", "Farm
// 1234", etc. Compare digits only.
const normalizeFsa = (s: string) => s.replace(/\D/g, "");
// Parcel numbers match on either the tax normalization (separators kept)
// or the raw digit string, since leases often print the digits-only form.
const digitsOnly = (s: string) => s.replace(/\D/g, "");

export function matchLeaseLand(
  land: ExtractedLeaseLand,
  properties: MatchableProperty[],
  parcels: MatchableParcel[]
): LeaseLandMatch {
  const landFsa = new Set(land.fsa_numbers.map(normalizeFsa).filter(Boolean));
  const landParcels = new Set(
    land.parcel_numbers.map(normalizeParcelNumber).filter(Boolean)
  );
  const landParcelDigits = new Set(
    land.parcel_numbers.map(digitsOnly).filter(Boolean)
  );
  const descriptionWords = new Set(
    land.description
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length >= 4)
  );

  let best: { id: string; score: number } | null = null;
  for (const property of properties) {
    let score = 0;

    for (const fsa of property.fsa_numbers ?? []) {
      if (landFsa.has(normalizeFsa(fsa))) score += 100;
    }
    for (const parcel of parcels) {
      if (parcel.property_id !== property.id) continue;
      if (
        landParcels.has(normalizeParcelNumber(parcel.parcel_number)) ||
        landParcelDigits.has(digitsOnly(parcel.parcel_number))
      ) {
        score += 90;
      }
    }

    // Name evidence: property name words appearing in the description.
    const nameWords = property.name
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length >= 4);
    const nameHits = nameWords.filter((w) => descriptionWords.has(w)).length;
    if (nameWords.length > 0 && nameHits === nameWords.length) score += 40;
    else if (nameHits > 0) score += 25;

    if (
      land.county &&
      property.county &&
      land.county.toLowerCase().includes(property.county.toLowerCase())
    ) {
      score += 5;
    }
    if (
      land.acres !== null &&
      property.acres !== null &&
      property.acres > 0 &&
      Math.abs(land.acres - property.acres) / property.acres <= 0.15
    ) {
      score += 20;
    }

    if (!best || score > best.score) best = { id: property.id, score };
  }

  // A single shared generic word ("farm") scores 25; require more.
  if (!best || best.score < 30) return { propertyId: null, strong: false };
  return { propertyId: best.id, strong: best.score >= 90 };
}
