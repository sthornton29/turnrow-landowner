// Owner-name normalization and clustering for county records. County
// assessors write the same person or company many different ways
// (THORNTON STUART, THORNTON S R ETUX, THE ALBEMARLE CORPORATION...);
// these pure functions collapse the variants so all of an entity's
// parcels can be found and grouped. Deterministic string work only:
// no network calls, no AI. Unit tests live in lib/ownerNames.test.ts.

export interface NormalizedOwner {
  // Canonical grouping key: uppercase tokens joined by single spaces,
  // noise removed, suffixes canonicalized. Empty string when the raw
  // name had no usable tokens.
  normalized: string;
  // Noise removed during normalization (ETUX, ESTATE, JR, C/O...).
  // Kept as metadata because it matters for display: ETUX vs ESTATE
  // tells the landowner something about the record.
  strippedTokens: string[];
}

// Single tokens that are markers, not name parts. WIFE/HUSBAND appear
// alone because "&" and "AND WIFE" are handled at the phrase level.
const NOISE_TOKENS = new Set([
  "ETAL", "ETUX", "ETVIR", "WIFE", "HUSBAND",
  "JR", "SR", "II", "III", "IV",
  "MR", "MRS",
  "TRUSTEE", "TRUSTEES", "TTEE", "TTEES",
  "REVOCABLE", "REV", "LIVING",
  "ESTATE", "EST", "HEIRS", "DECEASED", "LE",
]);

// Two-token phrases stripped as a unit (recorded joined, e.g. "ET UX").
const NOISE_PAIRS: Array<[string, string]> = [
  ["ET", "AL"], ["ET", "UX"], ["ET", "VIR"],
  ["AND", "WIFE"], ["AND", "HUSBAND"],
  ["LIFE", "ESTATE"],
];

// FAMILY is noise (SMITH FAMILY REVOCABLE TRUST -> SMITH TRUST) except
// when it is part of the company name itself (SMITH FAMILY FARMS).
const FAMILY_KEEPERS = new Set([
  "FARM", "FARMS", "RANCH", "PROPERTIES", "HOLDINGS", "LAND", "LANDS", "TIMBER",
]);

const SUFFIX_MAP: Record<string, string> = {
  CORPORATION: "CORP",
  INCORPORATED: "INC",
  COMPANY: "CO",
  LIMITED: "LTD",
  PARTNERSHIP: "LP",
};

export function normalizeOwnerName(raw: string): NormalizedOwner {
  const stripped: string[] = [];
  let text = raw.toUpperCase().trim();

  // "C/O ..." is a mailing instruction: drop it and everything after,
  // but keep it as metadata. Handled before punctuation stripping so
  // the slash still identifies it.
  const careOf = text.search(/(^|\s)C\/O(\s|$)/);
  if (careOf >= 0) {
    stripped.push(text.slice(careOf).trim());
    text = text.slice(0, careOf);
  }

  // Punctuation to spaces: periods, commas, apostrophes, ampersands,
  // hyphens between name parts, slashes, and anything else non-alphanumeric.
  text = text.replace(/[^A-Z0-9]+/g, " ").trim();
  let tokens = text.length > 0 ? text.split(" ") : [];

  // Canonicalize multi-token suffix spellings BEFORE noise stripping so
  // FAMILY LIMITED PARTNERSHIP becomes FLP instead of losing FAMILY.
  tokens = canonicalizeSequences(tokens);

  // Phrase-level noise (ET UX, AND WIFE, LIFE ESTATE).
  const afterPairs: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const pair = NOISE_PAIRS.find(
      ([a, b]) => tokens[i] === a && tokens[i + 1] === b
    );
    if (pair) {
      stripped.push(`${pair[0]} ${pair[1]}`);
      i++;
      continue;
    }
    afterPairs.push(tokens[i]);
  }

  // Single-token noise plus the FAMILY rule and suffix canonicalization.
  const result: string[] = [];
  for (let i = 0; i < afterPairs.length; i++) {
    const token = afterPairs[i];
    if (token === "FAMILY") {
      const next = afterPairs[i + 1];
      if (next && FAMILY_KEEPERS.has(next)) result.push(token);
      else stripped.push(token);
      continue;
    }
    if (NOISE_TOKENS.has(token)) {
      stripped.push(token);
      continue;
    }
    result.push(SUFFIX_MAP[token] ?? token);
  }

  // Leading or trailing THE carries no identity (THE ALBEMARLE
  // CORPORATION and ALBEMARLE CORPORATION THE are the same company).
  while (result.length > 1 && result[0] === "THE") result.shift();
  while (result.length > 1 && result[result.length - 1] === "THE") result.pop();

  return { normalized: result.join(" "), strippedTokens: stripped };
}

// L L C -> LLC, LIMITED LIABILITY CO/COMPANY -> LLC,
// FAMILY LIMITED PARTNERSHIP -> FLP, LIMITED PARTNERSHIP -> LP.
function canonicalizeSequences(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "L" && tokens[i + 1] === "L" && tokens[i + 2] === "C") {
      out.push("LLC");
      i += 2;
      continue;
    }
    if (
      tokens[i] === "LIMITED" &&
      tokens[i + 1] === "LIABILITY" &&
      (tokens[i + 2] === "CO" || tokens[i + 2] === "COMPANY")
    ) {
      out.push("LLC");
      i += 2;
      continue;
    }
    if (
      tokens[i] === "FAMILY" &&
      tokens[i + 1] === "LIMITED" &&
      tokens[i + 2] === "PARTNERSHIP"
    ) {
      out.push("FLP");
      i += 2;
      continue;
    }
    if (tokens[i] === "LIMITED" && tokens[i + 1] === "PARTNERSHIP") {
      out.push("LP");
      i += 1;
      continue;
    }
    out.push(tokens[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[] = new Array(cols).fill(0).map((_, j) => j);
  for (let i = 1; i < rows; i++) {
    let prev = dist[0];
    dist[0] = i;
    for (let j = 1; j < cols; j++) {
      const diag = prev;
      prev = dist[j];
      dist[j] =
        a[i - 1] === b[j - 1]
          ? diag
          : 1 + Math.min(diag, prev, dist[j - 1]);
    }
  }
  return dist[cols - 1];
}

// Two tokens refer to the same name part when they are equal, when one
// is an initial of the other (S matches STUART), or when both are long
// enough that a single-character difference is a typo, not a different name.
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  if (a.length >= 5 && b.length >= 5) return levenshtein(a, b) <= 1;
  return false;
}

// Token-set similarity: word order never matters (county records flip
// LASTNAME FIRSTNAME freely). Score is matched tokens over the smaller
// token count, so a middle initial present on one side but not the
// other does not penalize the match. 0 to 1.
export function ownerSimilarity(aNormalized: string, bNormalized: string): number {
  return similarityDetail(aNormalized, bNormalized).score;
}

// Score plus the absolute matched-token count, used by clustering to
// break ties: THORNTON S R matches both THORNTON SAM and THORNTON
// STUART R at score 1, but the latter accounts for all three tokens.
function similarityDetail(
  aNormalized: string,
  bNormalized: string
): { score: number; matches: number } {
  const aTokens = aNormalized.length > 0 ? aNormalized.split(" ") : [];
  const bTokens = bNormalized.length > 0 ? bNormalized.split(" ") : [];
  if (aTokens.length === 0 || bTokens.length === 0) return { score: 0, matches: 0 };
  const [small, large] =
    aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  const used = new Set<number>();
  let matches = 0;
  for (const token of small) {
    // Prefer an exact match before settling for an initial/typo match.
    let hit = large.findIndex((t, i) => !used.has(i) && t === token);
    if (hit < 0) {
      hit = large.findIndex((t, i) => !used.has(i) && tokensMatch(token, t));
    }
    if (hit >= 0) {
      used.add(hit);
      matches++;
    }
  }
  return { score: matches / small.length, matches };
}

export const CLUSTER_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

export interface OwnerRecordInput {
  id: string; // caller's row id
  ownerName: string; // verbatim as the county printed it
  normalized: string;
  acres: number;
}

export interface OwnerClusterResult {
  recordIds: string[];
  variants: string[]; // distinct verbatim owner names, largest first
  displayName: string; // the most complete variant
  knownEntityId: string | null;
  totalAcres: number;
}

// How complete a normalized name is: full words count far more than
// initials, so THORNTON STUART R outranks THORNTON S R.
function completeness(normalized: string): number {
  const tokens = normalized.length > 0 ? normalized.split(" ") : [];
  return tokens.reduce((sum, t) => sum + (t.length > 1 ? 10 : 1), 0);
}

// Greedy clustering of normalized owner names. Records whose normalized
// name matches a saved alias pre-group under that entity (knownAliases
// maps normalized alias -> entity id). Names are processed most complete
// first so specific forms (THORNTON STUART R) anchor clusters and
// initial forms (THORNTON S R) attach to them, not the reverse. Each
// candidate is compared against every cluster's most complete member
// and joins the best match: initials act like wildcards, so comparing
// against ANY member would let THORNTON S R chain THORNTON SAM and
// THORNTON STUART into one wrong group. Deterministic and instant at
// county-search sizes.
export function clusterOwners(
  records: OwnerRecordInput[],
  knownAliases: Map<string, string> = new Map()
): OwnerClusterResult[] {
  // Distinct normalized names with their records.
  const byName = new Map<string, OwnerRecordInput[]>();
  for (const record of records) {
    const list = byName.get(record.normalized);
    if (list) list.push(record);
    else byName.set(record.normalized, [record]);
  }

  const acresOf = (n: string) =>
    byName.get(n)!.reduce((sum, r) => sum + r.acres, 0);
  const names = Array.from(byName.keys()).sort((a, b) => {
    const complete = completeness(b) - completeness(a);
    if (complete !== 0) return complete;
    return acresOf(b) - acresOf(a);
  });

  interface Cluster {
    memberNames: string[];
    representative: string; // most complete member
    knownEntityId: string | null;
  }
  const clusters: Cluster[] = [];
  const clusterByEntity = new Map<string, Cluster>();

  const join = (cluster: Cluster, name: string) => {
    cluster.memberNames.push(name);
    if (completeness(name) > completeness(cluster.representative)) {
      cluster.representative = name;
    }
  };

  for (const name of names) {
    if (name.length === 0) {
      // Blank owners never group with anything.
      clusters.push({ memberNames: [name], representative: name, knownEntityId: null });
      continue;
    }
    const entityId = knownAliases.get(name);
    if (entityId) {
      const existing = clusterByEntity.get(entityId);
      if (existing) {
        join(existing, name);
      } else {
        const cluster: Cluster = {
          memberNames: [name],
          representative: name,
          knownEntityId: entityId,
        };
        clusters.push(cluster);
        clusterByEntity.set(entityId, cluster);
      }
      continue;
    }
    let home: Cluster | null = null;
    let bestScore = 0;
    let bestMatches = 0;
    for (const cluster of clusters) {
      if (cluster.representative.length === 0) continue;
      const { score, matches } = similarityDetail(name, cluster.representative);
      if (score < CLUSTER_THRESHOLD) continue;
      if (score > bestScore || (score === bestScore && matches > bestMatches)) {
        home = cluster;
        bestScore = score;
        bestMatches = matches;
      }
    }
    if (home) join(home, name);
    else clusters.push({ memberNames: [name], representative: name, knownEntityId: null });
  }

  const results = clusters.map((cluster): OwnerClusterResult => {
    const members = cluster.memberNames.flatMap((n) => byName.get(n)!);
    const variantCounts = new Map<string, number>();
    for (const m of members) {
      variantCounts.set(m.ownerName, (variantCounts.get(m.ownerName) ?? 0) + 1);
    }
    const variants = Array.from(variantCounts.keys()).sort(
      (a, b) => variantCounts.get(b)! - variantCounts.get(a)!
    );
    return {
      recordIds: members.map((m) => m.id),
      variants,
      displayName: pickDisplayName(variants),
      knownEntityId: cluster.knownEntityId,
      totalAcres: members.reduce((sum, m) => sum + m.acres, 0),
    };
  });

  return results.sort((a, b) => b.totalAcres - a.totalAcres);
}

// The most complete variant: most normalized tokens, ties broken by the
// longer verbatim string. "THORNTON STUART R" beats "THORNTON S R ETUX"
// because ETUX is noise and S is no more complete than STUART is.
export function pickDisplayName(variants: string[]): string {
  let best = variants[0] ?? "";
  let bestScore = -1;
  for (const variant of variants) {
    const norm = normalizeOwnerName(variant).normalized;
    const tokens = norm.length > 0 ? norm.split(" ") : [];
    // Full words count far more than initials so STUART outranks S; the
    // raw length breaks ties so THE ALBEMARLE CORPORATION beats
    // ALBEMARLE CORP even though both normalize identically.
    const score =
      tokens.reduce((sum, t) => sum + (t.length > 1 ? 10 : 1), 0) * 1000 +
      variant.length;
    if (score > bestScore) {
      bestScore = score;
      best = variant;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Entity search planning
// ---------------------------------------------------------------------------

export interface EntityQueryPlan {
  // The rarest/most distinctive token: the anchor of the broad county
  // query. Longest surviving token is the heuristic (county frequency
  // data does not exist); surnames and distinctive company words win.
  distinctive: string;
  // Remaining full-word tokens, longest first, for narrower fallback
  // queries when the distinctive token alone is too common.
  others: string[];
}

export function planEntityQuery(seed: string): EntityQueryPlan | null {
  const { normalized } = normalizeOwnerName(seed);
  const tokens = normalized.length > 0 ? normalized.split(" ") : [];
  const words = tokens.filter((t) => t.length >= 2);
  if (words.length === 0) return null;
  const distinctive = [...words].sort((a, b) => b.length - a.length)[0];
  const rest = words.filter((t) => t !== distinctive);
  rest.sort((a, b) => b.length - a.length);
  return { distinctive, others: rest };
}
