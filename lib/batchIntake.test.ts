import { describe, expect, it } from "vitest";
import {
  aiReadable,
  buildDuplicateIndex,
  duplicateKey,
  folderProperty,
  proposeBatchRow,
  runPool,
  safeStorageName,
  type BatchProposalInput,
} from "./batchIntake";

const props = [
  { id: "cot", name: "Cottontown" },
  { id: "rf", name: "Riverfront", aliases: ["LSM Marital Trust River Front"] },
  { id: "rh", name: "Rocky Hill" },
];
const names: Record<string, string> = { cot: "Cottontown", rf: "Riverfront", rh: "Rocky Hill" };

function input(over: Partial<BatchProposalInput> = {}): BatchProposalInput {
  return {
    readable: true,
    aiError: null,
    docType: "deed_warranty",
    confidence: "high",
    specializedKind: null,
    preselect: ["cot"],
    conflict: false,
    folderPropertyId: null,
    contextPropertyId: null,
    duplicate: false,
    propertyName: (id) => names[id] ?? id,
    ...over,
  };
}

describe("safeStorageName", () => {
  it("replaces characters Storage rejects", () => {
    expect(safeStorageName("Deed - Marital Trust 5.88% Interest in Betts.pdf")).toBe(
      "Deed - Marital Trust 5.88_ Interest in Betts.pdf"
    );
    expect(safeStorageName("Plat #2?.pdf")).toBe("Plat _2_.pdf");
  });
  it("keeps ordinary names and strips accents", () => {
    expect(safeStorageName("Survey (2019) & Map, final.pdf")).toBe("Survey (2019) & Map, final.pdf");
    expect(safeStorageName("Café deed.pdf")).toBe("Cafe deed.pdf");
  });
  it("never returns an empty name", () => {
    expect(safeStorageName("%%%")).toBe("_");
    expect(safeStorageName("")).toBe("file");
  });
});

describe("aiReadable", () => {
  it("reads PDFs, images, and spreadsheets but not Word files", () => {
    expect(aiReadable("a.pdf", "application/pdf")).toBe(true);
    expect(aiReadable("a.JPG", "")).toBe(true);
    expect(aiReadable("a.xlsx", null)).toBe(true);
    expect(aiReadable("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
    expect(aiReadable("a.doc", "application/msword")).toBe(false);
  });
});

describe("duplicateKey", () => {
  it("ignores case and surrounding space in the name", () => {
    expect(duplicateKey(" Deed.PDF", 10)).toBe(duplicateKey("deed.pdf", 10));
    expect(duplicateKey("deed.pdf", 10)).not.toBe(duplicateKey("deed.pdf", 11));
  });
});

describe("buildDuplicateIndex", () => {
  const isDup = buildDuplicateIndex([
    { id: "doc-1", file_name: "Sledge Farm Warranty Deed.pdf", size_bytes: 1000 },
    { file_name: "x.pdf", size_bytes: null },
  ]);
  it("matches the same name and size, ignoring case", () => {
    expect(isDup("sledge farm warranty deed.PDF", 1000)).toBe("doc-1");
  });
  it("matches a renamed copy with a prefix", () => {
    expect(isDup("004 Warranty deed - Sledge Farm Warranty Deed.pdf", 1000)).toBe("doc-1");
  });
  it("needs the same size", () => {
    expect(isDup("Sledge Farm Warranty Deed.pdf", 1001)).toBeNull();
    expect(isDup("x.pdf", 0)).toBeNull();
  });
});

describe("folderProperty", () => {
  it("matches the deepest folder named after a property", () => {
    expect(folderProperty("2 Property Documents/Cottontown/Optional/deed.pdf", props)).toBe("cot");
    expect(folderProperty("Rocky Hill\\deed.pdf", props)).toBe("rh");
  });
  it("matches aliases and ignores punctuation and case", () => {
    expect(folderProperty("Land/lsm marital trust river-front/x.pdf", props)).toBe("rf");
  });
  it("never uses the file name itself", () => {
    expect(folderProperty("Scans/Cottontown.pdf", props)).toBeNull();
    expect(folderProperty("deed.pdf", props)).toBeNull();
    expect(folderProperty(null, props)).toBeNull();
  });
});

describe("proposeBatchRow", () => {
  it("is ready when the AI is sure of the type and one property", () => {
    expect(proposeBatchRow(input())).toEqual({ status: "ready", propertyIds: ["cot"], notes: [] });
  });
  it("uses the folder when the AI found no property", () => {
    const r = proposeBatchRow(input({ preselect: [], folderPropertyId: "rh" }));
    expect(r.status).toBe("ready");
    expect(r.propertyIds).toEqual(["rh"]);
    expect(r.notes[0]).toMatch(/folder name \(Rocky Hill\)/);
  });
  it("asks for a look when the folder and the document disagree, keeping both", () => {
    const r = proposeBatchRow(input({ folderPropertyId: "rh" }));
    expect(r.status).toBe("review");
    expect(r.propertyIds).toEqual(["cot", "rh"]);
  });
  it("asks for a look with no property, a conflict, a low-confidence type, or a read failure", () => {
    expect(proposeBatchRow(input({ preselect: [] })).status).toBe("review");
    expect(proposeBatchRow(input({ conflict: true })).status).toBe("review");
    expect(proposeBatchRow(input({ confidence: "low" })).status).toBe("review");
    expect(proposeBatchRow(input({ docType: "other" })).status).toBe("review");
    expect(proposeBatchRow(input({ aiError: "429" })).notes[0]).toMatch(/Could not be read: 429/);
  });
  it("asks for a look at files the AI cannot read, but keeps the folder property", () => {
    const r = proposeBatchRow(input({ readable: false, docType: null, preselect: [], folderPropertyId: "cot" }));
    expect(r.status).toBe("review");
    expect(r.propertyIds).toEqual(["cot"]);
  });
  it("always includes the page's own property when uploading from a property page", () => {
    expect(proposeBatchRow(input({ preselect: [], contextPropertyId: "rf" }))).toMatchObject({
      status: "ready",
      propertyIds: ["rf"],
    });
  });
  it("flags duplicates and specialized documents ahead of everything else", () => {
    const dup = proposeBatchRow(input({ duplicate: true, preselect: [], confidence: "low" }));
    expect(dup.status).toBe("duplicate");
    expect(dup.notes).toHaveLength(1);
    const tax = proposeBatchRow(input({ specializedKind: "tax_statement" }));
    expect(tax.status).toBe("elsewhere");
    expect(tax.notes[0]).toMatch(/Taxes > Upload/);
  });
});

describe("runPool", () => {
  it("runs every item with at most `limit` in flight", async () => {
    let live = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      live--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
