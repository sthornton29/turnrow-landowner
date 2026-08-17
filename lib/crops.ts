// Crop name normalization and matching. The tenant's crop names (from
// the farm software's plantings and marketing prices) and the
// landowner's lease assumption crops are entered independently, so every
// tenant-data lookup keys through this matcher; a value can never attach
// to a crop that does not match. Conservative by design: when a tenant
// crop cannot be confidently matched, callers show it under its own
// tenant-named row instead of guessing. Unit tests in crops.test.ts.

// Whole-phrase synonyms, applied after normalization (lowercase,
// punctuation stripped, tokens singularized).
const SYNONYMS: Record<string, string> = {
  bean: "soybean",
  soy: "soybean",
  "soy bean": "soybean",
  maize: "corn",
  "field corn": "corn",
  "winter wheat": "wheat",
  "spring wheat": "wheat",
  rapeseed: "canola",
  rape: "canola",
  "winter canola": "canola",
  "upland cotton": "cotton",
  milo: "sorghum",
  "grain sorghum": "sorghum",
};

function singularToken(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

// Canonical form used for equality: "" when there is no usable name.
export function canonicalCrop(name: string | null | undefined): string {
  const normalized = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(singularToken)
    .join(" ");
  return SYNONYMS[normalized] ?? normalized;
}

export function sameCrop(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const ca = canonicalCrop(a);
  return ca !== "" && ca === canonicalCrop(b);
}

// The candidate (verbatim) that confidently matches, or null.
export function matchCrop(
  crop: string | null | undefined,
  candidates: Array<string | null | undefined>
): string | null {
  const c = canonicalCrop(crop);
  if (c === "") return null;
  for (const candidate of candidates) {
    if (candidate && canonicalCrop(candidate) === c) return candidate;
  }
  return null;
}
