import { describe, expect, it } from "vitest";
import {
  clusterOwners,
  normalizeOwnerName,
  ownerSimilarity,
  pickDisplayName,
  planEntityQuery,
  tokensMatch,
  CLUSTER_THRESHOLD,
} from "./ownerNames";

describe("normalizeOwnerName", () => {
  it("collapses the Thornton variants to matchable forms", () => {
    expect(normalizeOwnerName("THORNTON STUART").normalized).toBe("THORNTON STUART");
    expect(normalizeOwnerName("THORNTON STUART R").normalized).toBe("THORNTON STUART R");
    expect(normalizeOwnerName("THORNTON S R ETUX").normalized).toBe("THORNTON S R");
    expect(normalizeOwnerName("THORNTON STUART & WIFE").normalized).toBe("THORNTON STUART");
  });

  it("collapses the Albemarle variants to one normalized form", () => {
    const forms = [
      "ALBEMARLE CORP",
      "THE ALBEMARLE CORPORATION",
      "ALBEMARLE CORPORATION THE",
    ];
    for (const form of forms) {
      expect(normalizeOwnerName(form).normalized).toBe("ALBEMARLE CORP");
    }
  });

  it("strips estate markers but keeps them as metadata", () => {
    const a = normalizeOwnerName("THORNTON STUART ESTATE");
    expect(a.normalized).toBe("THORNTON STUART");
    expect(a.strippedTokens).toContain("ESTATE");

    const b = normalizeOwnerName("SMITH JOHN EST");
    expect(b.normalized).toBe("SMITH JOHN");
    expect(b.strippedTokens).toContain("EST");

    const c = normalizeOwnerName("SMITH JOHN LIFE ESTATE");
    expect(c.normalized).toBe("SMITH JOHN");
    expect(c.strippedTokens).toContain("LIFE ESTATE");
  });

  it("keeps ETUX and ET UX as metadata", () => {
    expect(normalizeOwnerName("THORNTON S R ETUX").strippedTokens).toContain("ETUX");
    const spaced = normalizeOwnerName("THORNTON S R ET UX");
    expect(spaced.normalized).toBe("THORNTON S R");
    expect(spaced.strippedTokens).toContain("ET UX");
  });

  it("strips ET AL, suffixes, and honorifics", () => {
    expect(normalizeOwnerName("SMITH JOHN ET AL").normalized).toBe("SMITH JOHN");
    expect(normalizeOwnerName("SMITH JOHN ETAL").normalized).toBe("SMITH JOHN");
    expect(normalizeOwnerName("SMITH JOHN JR").normalized).toBe("SMITH JOHN");
    expect(normalizeOwnerName("SMITH JOHN III").normalized).toBe("SMITH JOHN");
    expect(normalizeOwnerName("MR & MRS JOHN SMITH").normalized).toBe("JOHN SMITH");
    expect(normalizeOwnerName("JONES MARY AND HUSBAND").normalized).toBe("JONES MARY");
  });

  it("normalizes LLC punctuation variants", () => {
    const forms = [
      "BIG CREEK LLC",
      "BIG CREEK L.L.C.",
      "BIG CREEK L L C",
      "BIG CREEK LIMITED LIABILITY COMPANY",
      "BIG CREEK LIMITED LIABILITY CO",
    ];
    for (const form of forms) {
      expect(normalizeOwnerName(form).normalized).toBe("BIG CREEK LLC");
    }
  });

  it("canonicalizes partnership and company suffixes", () => {
    expect(normalizeOwnerName("THORNTON FAMILY LIMITED PARTNERSHIP").normalized).toBe(
      "THORNTON FLP"
    );
    expect(normalizeOwnerName("DELTA LAND LIMITED PARTNERSHIP").normalized).toBe(
      "DELTA LAND LP"
    );
    expect(normalizeOwnerName("ACME TIMBER COMPANY").normalized).toBe("ACME TIMBER CO");
    expect(normalizeOwnerName("ACME TIMBER INCORPORATED").normalized).toBe(
      "ACME TIMBER INC"
    );
  });

  it("keeps FAMILY in company names, strips it in trust boilerplate", () => {
    expect(normalizeOwnerName("SMITH FAMILY FARMS LLC").normalized).toBe(
      "SMITH FAMILY FARMS LLC"
    );
    const trust = normalizeOwnerName("SMITH FAMILY REVOCABLE LIVING TRUST");
    expect(trust.normalized).toBe("SMITH TRUST");
    expect(trust.strippedTokens).toEqual(
      expect.arrayContaining(["FAMILY", "REVOCABLE", "LIVING"])
    );
  });

  it("drops C/O and everything after it, keeping it as metadata", () => {
    const result = normalizeOwnerName("THORNTON STUART C/O JANE THORNTON");
    expect(result.normalized).toBe("THORNTON STUART");
    expect(result.strippedTokens).toContain("C/O JANE THORNTON");
  });

  it("treats hyphens and apostrophes as spaces", () => {
    expect(normalizeOwnerName("O'NEAL SMITH-JONES").normalized).toBe(
      "O NEAL SMITH JONES"
    );
  });

  it("handles empty and whitespace-only input", () => {
    expect(normalizeOwnerName("").normalized).toBe("");
    expect(normalizeOwnerName("   ").normalized).toBe("");
  });
});

describe("tokensMatch", () => {
  it("matches an initial against a full word", () => {
    expect(tokensMatch("S", "STUART")).toBe(true);
    expect(tokensMatch("STUART", "S")).toBe(true);
    expect(tokensMatch("R", "STUART")).toBe(false);
  });

  it("tolerates one-letter typos in long tokens only", () => {
    expect(tokensMatch("THOMPSON", "THOMSON")).toBe(true);
    expect(tokensMatch("SMITH", "SMYTH")).toBe(true);
    expect(tokensMatch("SAM", "SAL")).toBe(false);
  });
});

describe("ownerSimilarity", () => {
  it("ignores word order", () => {
    expect(ownerSimilarity("THORNTON STUART", "STUART THORNTON")).toBe(1);
  });

  it("matches initial forms without penalty for extra middle initials", () => {
    expect(
      ownerSimilarity("THORNTON STUART", "THORNTON S R")
    ).toBeGreaterThanOrEqual(CLUSTER_THRESHOLD);
    expect(
      ownerSimilarity("THORNTON STUART", "THORNTON STUART R")
    ).toBeGreaterThanOrEqual(CLUSTER_THRESHOLD);
  });

  it("keeps different first names apart", () => {
    expect(ownerSimilarity("THORNTON STUART", "THORNTON SAM")).toBeLessThan(
      CLUSTER_THRESHOLD
    );
  });

  it("keeps different companies sharing a suffix apart", () => {
    expect(ownerSimilarity("ALBEMARLE CORP", "PINNACLE CORP")).toBeLessThan(
      CLUSTER_THRESHOLD
    );
  });
});

describe("clusterOwners", () => {
  const record = (id: string, ownerName: string, acres: number) => ({
    id,
    ownerName,
    normalized: normalizeOwnerName(ownerName).normalized,
    acres,
  });

  it("groups all the Thornton variants together, Sam separately", () => {
    const clusters = clusterOwners([
      record("1", "THORNTON STUART", 120),
      record("2", "THORNTON STUART R", 40),
      record("3", "THORNTON S R ETUX", 80),
      record("4", "THORNTON STUART & WIFE", 60),
      record("5", "THORNTON SAM", 200),
    ]);
    expect(clusters).toHaveLength(2);
    const stuart = clusters.find((c) => c.recordIds.includes("1"))!;
    expect(new Set(stuart.recordIds)).toEqual(new Set(["1", "2", "3", "4"]));
    expect(stuart.totalAcres).toBe(300);
    const sam = clusters.find((c) => c.recordIds.includes("5"))!;
    expect(sam.recordIds).toEqual(["5"]);
  });

  it("groups company variants and sorts groups by acres descending", () => {
    const clusters = clusterOwners([
      record("1", "ALBEMARLE CORP", 500),
      record("2", "THE ALBEMARLE CORPORATION", 300),
      record("3", "ALBEMARLE CORPORATION THE", 100),
      record("4", "THORNTON STUART", 50),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].totalAcres).toBe(900);
    expect(new Set(clusters[0].recordIds)).toEqual(new Set(["1", "2", "3"]));
    expect(clusters[0].variants).toHaveLength(3);
  });

  it("pre-groups records matching known aliases under that entity", () => {
    const aliases = new Map<string, string>([
      ["THORNTON STUART", "entity-1"],
      ["THORNTON S R", "entity-1"],
    ]);
    const clusters = clusterOwners(
      [record("1", "THORNTON STUART", 100), record("2", "THORNTON S R ETUX", 50)],
      aliases
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].knownEntityId).toBe("entity-1");
  });

  it("keeps blank owner names isolated", () => {
    const clusters = clusterOwners([
      record("1", "", 10),
      record("2", "", 10),
      record("3", "THORNTON STUART", 10),
    ]);
    const blank = clusters.filter((c) => c.variants[0] === "");
    expect(blank.length).toBeGreaterThanOrEqual(1);
    for (const cluster of blank) {
      expect(cluster.recordIds).not.toContain("3");
    }
  });
});

describe("pickDisplayName", () => {
  it("prefers the most complete variant over initials and noise", () => {
    expect(
      pickDisplayName([
        "THORNTON S R ETUX",
        "THORNTON STUART",
        "THORNTON STUART R",
      ])
    ).toBe("THORNTON STUART R");
  });

  it("prefers the spelled-out company over the abbreviated one", () => {
    expect(
      pickDisplayName(["ALBEMARLE CORP", "THE ALBEMARLE CORPORATION"])
    ).toBe("THE ALBEMARLE CORPORATION");
  });
});

describe("planEntityQuery", () => {
  it("picks the longest surviving token regardless of typed order", () => {
    expect(planEntityQuery("Stuart Thornton")).toEqual({
      distinctive: "THORNTON",
      others: ["STUART"],
    });
    expect(planEntityQuery("THORNTON STUART")).toEqual({
      distinctive: "THORNTON",
      others: ["STUART"],
    });
  });

  it("picks the distinctive company word over the suffix", () => {
    expect(planEntityQuery("The Albemarle Corporation")).toEqual({
      distinctive: "ALBEMARLE",
      others: ["CORP"],
    });
  });

  it("returns null when no full word survives", () => {
    expect(planEntityQuery("S R")).toBeNull();
    expect(planEntityQuery("")).toBeNull();
  });
});
