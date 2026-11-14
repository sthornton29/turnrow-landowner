import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteDocumentEverywhere,
  mergeExtracted,
  replaceDocumentFile,
  uploadDocument,
  uploadErrorCopy,
} from "./classify";

// A small in-memory stand-in for the Supabase client: the three tables
// and the storage bucket these helpers touch, with a log of what was
// done in what order and a way to make any one step fail.

type Row = Record<string, unknown>;
type Failure = { code?: string; message: string };

function fakeSupabase(seed: {
  documents?: Row[];
  document_versions?: Row[];
  objects?: string[];
  fail?: Record<string, Failure>;
  // Storage answers for the "is it there" check, when it should not
  // simply reflect the bucket: "throw" stands for being offline.
  exists?: "throw";
}) {
  const db: Record<string, Row[]> = {
    documents: [...(seed.documents ?? [])],
    document_versions: [...(seed.document_versions ?? [])],
    document_properties: [],
  };
  const objects = new Set(seed.objects ?? []);
  const fail = seed.fail ?? {};
  const log: string[] = [];
  let made = 0;

  function from(table: string) {
    let op = "select";
    let payload: Row[] | Row | null = null;
    const filters: Array<(r: Row) => boolean> = [];
    const match = (r: Row) => filters.every((f) => f(r));
    async function run(): Promise<{ data: Row[] | null; error: Failure | null }> {
      log.push(`${table}.${op}`);
      const failure = fail[`${table}.${op}`];
      if (failure) return { data: null, error: failure };
      if (op === "insert") {
        const rows = (payload as Row[]).map((p) => ({ id: `new-${++made}`, ...p }));
        db[table].push(...rows);
        return { data: rows, error: null };
      }
      const hit = db[table].filter(match);
      if (op === "update") hit.forEach((r) => Object.assign(r, payload as Row));
      if (op === "delete") {
        db[table] = db[table].filter((r) => !match(r));
        // document_versions rows cascade with their document.
        if (table === "documents") {
          const ids = hit.map((r) => r.id);
          db.document_versions = db.document_versions.filter((v) => !ids.includes(v.document_id));
        }
      }
      return { data: hit, error: null };
    }
    const q = {
      select: () => q,
      insert: (rows: Row | Row[]) => {
        op = "insert";
        payload = Array.isArray(rows) ? rows : [rows];
        return q;
      },
      update: (patch: Row) => {
        op = "update";
        payload = patch;
        return q;
      },
      delete: () => {
        op = "delete";
        return q;
      },
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return q;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return q;
      },
      single: () =>
        run().then(({ data, error }) => ({
          data: data?.[0] ?? null,
          error: error ?? (data && data.length > 0 ? null : { code: "PGRST116", message: "no rows" }),
        })),
      then: <T>(resolve: (v: { data: Row[] | null; error: Failure | null }) => T) => run().then(resolve),
    };
    return q;
  }

  const bucket = {
    exists: async (path: string) => {
      log.push(`storage.exists ${path}`);
      if (seed.exists === "throw") throw new Error("Failed to fetch");
      return objects.has(path) ? { data: true, error: null } : { data: false, error: { message: "Object not found" } };
    },
    upload: async (path: string) => {
      log.push(`storage.upload ${path}`);
      if (fail["storage.upload"]) return { data: null, error: fail["storage.upload"] };
      objects.add(path);
      return { data: { path }, error: null };
    },
    remove: async (paths: string[]) => {
      log.push(`storage.remove ${[...paths].sort().join(",")}`);
      if (fail["storage.remove"]) return { data: null, error: fail["storage.remove"] };
      for (const p of paths) objects.delete(p);
      return { data: [], error: null };
    },
  };

  const client = { from, storage: { from: () => bucket } } as unknown as SupabaseClient;
  return { client, db, objects, log };
}

const RLS: Failure = { code: "42501", message: 'new row violates row-level security policy for table "documents"' };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteDocumentEverywhere", () => {
  const taxPdf = "org/intake/1-county-bills.pdf";
  // One tax PDF holding three statements: three document rows, one file.
  const threeStatements = () =>
    fakeSupabase({
      documents: [
        { id: "a", entity_type: "tax_statement", storage_path: taxPdf },
        { id: "b", entity_type: "tax_statement", storage_path: taxPdf },
        { id: "c", entity_type: "tax_statement", storage_path: taxPdf },
      ],
      objects: [taxPdf],
    });

  it("keeps a file that another document still uses", async () => {
    const s = threeStatements();
    const err = await deleteDocumentEverywhere(
      s.client,
      { id: "a", storage_path: taxPdf, entity_type: "tax_statement" },
      { seesEveryDocument: true }
    );
    expect(err).toBeNull();
    expect(s.db.documents.map((d) => d.id)).toEqual(["b", "c"]);
    expect(s.objects.has(taxPdf)).toBe(true);
    expect(s.log.some((l) => l.startsWith("storage.remove"))).toBe(false);
  });

  it("removes the file once the last document using it is deleted", async () => {
    const s = threeStatements();
    for (const id of ["a", "b", "c"]) {
      await deleteDocumentEverywhere(
        s.client,
        { id, storage_path: taxPdf, entity_type: "tax_statement" },
        { seesEveryDocument: true }
      );
    }
    expect(s.db.documents).toEqual([]);
    expect(s.objects.has(taxPdf)).toBe(false);
  });

  it("deletes the row before it touches storage, and removes superseded versions too", async () => {
    const s = fakeSupabase({
      documents: [{ id: "d", entity_type: "property", storage_path: "org/property/2-deed.pdf" }],
      document_versions: [{ id: "v1", document_id: "d", storage_path: "org/property/1-deed-old.pdf" }],
      objects: ["org/property/2-deed.pdf", "org/property/1-deed-old.pdf"],
    });
    const err = await deleteDocumentEverywhere(s.client, { id: "d", storage_path: "org/property/2-deed.pdf", entity_type: "property" });
    expect(err).toBeNull();
    expect(s.objects.size).toBe(0);
    const del = s.log.indexOf("documents.delete");
    const rm = s.log.findIndex((l) => l.startsWith("storage.remove"));
    expect(del).toBeGreaterThanOrEqual(0);
    expect(rm).toBeGreaterThan(del);
  });

  it("keeps a version file that another document's history still points at", async () => {
    const shared = "org/property/shared.pdf";
    const s = fakeSupabase({
      documents: [
        { id: "d", entity_type: "property", storage_path: "org/property/d.pdf" },
        { id: "e", entity_type: "property", storage_path: "org/property/e.pdf" },
      ],
      document_versions: [
        { id: "v1", document_id: "d", storage_path: shared },
        { id: "v2", document_id: "e", storage_path: shared },
      ],
      objects: ["org/property/d.pdf", "org/property/e.pdf", shared],
    });
    await deleteDocumentEverywhere(s.client, { id: "d", storage_path: "org/property/d.pdf", entity_type: "property" });
    expect([...s.objects].sort()).toEqual(["org/property/e.pdf", shared].sort());
  });

  it("says so, in plain words, and leaves the file when the row cannot be deleted", async () => {
    const s = fakeSupabase({
      documents: [{ id: "d", entity_type: "property", storage_path: "org/property/d.pdf" }],
      objects: ["org/property/d.pdf"],
      fail: { "documents.delete": RLS },
    });
    const err = await deleteDocumentEverywhere(s.client, { id: "d", storage_path: "org/property/d.pdf", entity_type: "property" });
    expect(err).toMatch(/do not have access/);
    expect(err).not.toMatch(/row-level security/);
    expect(s.db.documents).toHaveLength(1);
    expect(s.objects.has("org/property/d.pdf")).toBe(true);
  });

  it("reports a delete that removed nothing (hidden by access rules, or already gone)", async () => {
    const s = fakeSupabase({ documents: [], objects: ["org/property/d.pdf"] });
    const err = await deleteDocumentEverywhere(s.client, { id: "d", storage_path: "org/property/d.pdf", entity_type: "property" });
    expect(err).toMatch(/was not deleted/);
    expect(s.objects.has("org/property/d.pdf")).toBe(true);
  });

  it("keeps the files when either reference check cannot be made", async () => {
    for (const failing of ["documents.select", "document_versions.select"]) {
      const s = fakeSupabase({
        documents: [{ id: "d", entity_type: "property", storage_path: "org/property/d.pdf" }],
        objects: ["org/property/d.pdf"],
        fail: { [failing]: { message: "Failed to fetch" } },
      });
      const err = await deleteDocumentEverywhere(s.client, { id: "d", storage_path: "org/property/d.pdf", entity_type: "property" });
      expect(err, failing).toBeNull();
      expect(s.db.documents, failing).toEqual([]);
      expect(s.objects.has("org/property/d.pdf"), failing).toBe(true);
    }
  });

  it("keeps a tax statement's file for a member who cannot see every document", async () => {
    // Row level security hides the other statements from this member, so
    // their check finds no other user of the file. It is kept anyway.
    const s = fakeSupabase({
      documents: [{ id: "a", entity_type: "tax_statement", storage_path: taxPdf }],
      objects: [taxPdf],
    });
    const err = await deleteDocumentEverywhere(s.client, { id: "a", storage_path: taxPdf, entity_type: "tax_statement" });
    expect(err).toBeNull();
    expect(s.db.documents).toEqual([]);
    expect(s.objects.has(taxPdf)).toBe(true);
  });
});

describe("uploadDocument", () => {
  const file = () => new File(["%PDF-1.4"], "Smith deed.pdf", { type: "application/pdf" });
  const base = {
    orgId: "org",
    entityType: "property" as const,
    entityId: "home",
    docType: "deed_warranty" as const,
    title: "Warranty Deed - Smith to Jones",
    aiSuggestedType: null,
  };

  it("reuses the intake's upload when it is really in storage", async () => {
    const s = fakeSupabase({ objects: ["org/intake/1-Smith deed.pdf"] });
    const res = await uploadDocument(s.client, { ...base, file: file(), storagePath: "org/intake/1-Smith deed.pdf" });
    expect("id" in res).toBe(true);
    expect(s.db.documents[0].storage_path).toBe("org/intake/1-Smith deed.pdf");
    expect(s.log.some((l) => l.startsWith("storage.upload"))).toBe(false);
  });

  it("never saves a row for a path with no file: it uploads the file again and saves that path", async () => {
    // The earlier upload is not there (it landed elsewhere, did not
    // finish, or was cleaned up). The row must not point at it.
    const s = fakeSupabase({ objects: [] });
    const res = await uploadDocument(s.client, { ...base, file: file(), storagePath: "org/intake/gone-Smith deed.pdf" });
    expect("id" in res).toBe(true);
    const saved = s.db.documents[0].storage_path as string;
    expect(saved).not.toBe("org/intake/gone-Smith deed.pdf");
    expect(s.objects.has(saved)).toBe(true);
  });

  it("saves nothing when the file cannot be confirmed in storage", async () => {
    const s = fakeSupabase({ objects: ["org/intake/1-Smith deed.pdf"], exists: "throw" });
    const res = await uploadDocument(s.client, { ...base, file: file(), storagePath: "org/intake/1-Smith deed.pdf" });
    expect("error" in res && res.error).toMatch(/Could not confirm/);
    expect(s.db.documents).toEqual([]);
    expect(s.log).not.toContain("documents.insert");
  });

  it("saves nothing when the upload fails, and says why without the raw error", async () => {
    const s = fakeSupabase({
      fail: { "storage.upload": { message: "tus: failed to upload chunk at offset 0, caused by [object ProgressEvent], originated from request (method: PATCH, url: https://x.supabase.co/storage/v1/upload/resumable/abc, response code: n/a)" } },
    });
    const res = await uploadDocument(s.client, { ...base, file: file() });
    expect("error" in res && res.error).toBe("Could not upload Smith deed.pdf. Check your connection and try again.");
    expect(s.db.documents).toEqual([]);
  });

  it("turns a refused save into a plain sentence and takes its own upload back out", async () => {
    const s = fakeSupabase({ fail: { "documents.insert": RLS } });
    const res = await uploadDocument(s.client, { ...base, entityType: "organization", entityId: "org", file: file() });
    expect("error" in res && res.error).toMatch(/do not have access/);
    expect("error" in res && res.error).not.toMatch(/row-level security/);
    expect(s.objects.size).toBe(0);
  });

  it("leaves the intake's own upload alone when the save is refused (the caller retries or cleans up)", async () => {
    const s = fakeSupabase({ objects: ["org/intake/1-Smith deed.pdf"], fail: { "documents.insert": RLS } });
    const res = await uploadDocument(s.client, { ...base, file: file(), storagePath: "org/intake/1-Smith deed.pdf" });
    expect("error" in res).toBe(true);
    expect(s.objects.has("org/intake/1-Smith deed.pdf")).toBe(true);
  });

  it("is SAVED with a warning, not an error, when only the property links fail", async () => {
    const s = fakeSupabase({ fail: { "document_properties.insert": { message: "Failed to fetch" } } });
    const res = await uploadDocument(s.client, { ...base, file: file(), propertyIds: ["home", "river"] });
    expect("error" in res).toBe(false);
    expect(res).toMatchObject({
      warning: "Saved, but it could not be linked to the property. Open the document to link it.",
    });
    expect("id" in res && res.id).toBeTruthy();
    // One document, and its file is still there for it.
    expect(s.db.documents).toHaveLength(1);
    expect(s.objects.has(s.db.documents[0].storage_path as string)).toBe(true);
  });

  it("links every chosen property on a clean save", async () => {
    const s = fakeSupabase({});
    const res = await uploadDocument(s.client, { ...base, file: file(), propertyIds: ["river"], evidence: { river: "parcel 12 matches River Place" } });
    expect(res).not.toHaveProperty("warning");
    expect(s.db.document_properties.map((l) => [l.property_id, l.evidence]).sort()).toEqual([
      ["home", null],
      ["river", "parcel 12 matches River Place"],
    ]);
  });
});

describe("replaceDocumentFile", () => {
  const doc = {
    id: "d",
    organization_id: "org",
    entity_type: "property" as const,
    storage_path: "org/property/old.pdf",
    file_name: "old.pdf",
    content_type: "application/pdf",
    size_bytes: 10,
    uploaded_by: null,
    created_at: "2026-01-01T00:00:00Z",
  };

  it("points the row at the new file and keeps the old one as a version", async () => {
    const s = fakeSupabase({ documents: [{ ...doc }], objects: ["org/property/old.pdf"] });
    const err = await replaceDocumentFile(s.client, doc, new File(["new"], "new.pdf", { type: "application/pdf" }));
    expect(err).toBeNull();
    const path = s.db.documents[0].storage_path as string;
    expect(path).not.toBe("org/property/old.pdf");
    expect(s.objects.has(path)).toBe(true);
    expect(s.db.document_versions.map((v) => v.storage_path)).toEqual(["org/property/old.pdf"]);
  });

  it("changes nothing when the new file cannot be confirmed in storage", async () => {
    const s = fakeSupabase({ documents: [{ ...doc }], objects: ["org/property/old.pdf"], exists: "throw" });
    const err = await replaceDocumentFile(s.client, doc, new File(["new"], "new.pdf", { type: "application/pdf" }));
    expect(err).toMatch(/was not replaced/);
    expect(s.db.documents[0].storage_path).toBe("org/property/old.pdf");
    expect(s.db.document_versions).toEqual([]);
  });
});

describe("mergeExtracted", () => {
  it("lays new keys over the LATEST stored value, not over a page's older copy", async () => {
    // Stored a few minutes ago by the plot screen; this caller's copy of
    // the row predates it.
    const s = fakeSupabase({
      documents: [
        {
          id: "d",
          extracted: {
            scan_kind: "deed",
            grantor: "Smith",
            spatial: { reference_label: "Sec 12" },
            legal_description_extraction: { kind: "aliquot" },
          },
        },
      ],
    });
    const res = await mergeExtracted(s.client, "d", { legal_description_plot: { plotted_acres: 40 } }, {
      columns: { produced_boundary_type: "property" },
    });
    expect("error" in res).toBe(false);
    expect(s.db.documents[0].extracted).toEqual({
      scan_kind: "deed",
      grantor: "Smith",
      spatial: { reference_label: "Sec 12" },
      legal_description_extraction: { kind: "aliquot" },
      legal_description_plot: { plotted_acres: 40 },
    });
    expect(s.db.documents[0].produced_boundary_type).toBe("property");
  });

  it("drops the keys it is told to (the previous form's fields) and keeps the rest", async () => {
    const s = fakeSupabase({
      documents: [{ id: "d", extracted: { scan_kind: "deed", grantor: "Smith", spatial: { computed: true } } }],
    });
    await mergeExtracted(s.client, "d", { scan_kind: "survey", surveyor: "Acme" }, { dropKeys: () => ["grantor", "grantee"] });
    expect(s.db.documents[0].extracted).toEqual({ scan_kind: "survey", surveyor: "Acme", spatial: { computed: true } });
  });

  it("writes nothing when the latest value cannot be read", async () => {
    const s = fakeSupabase({
      documents: [{ id: "d", extracted: { grantor: "Smith" } }],
      fail: { "documents.select": { message: "Failed to fetch" } },
    });
    const res = await mergeExtracted(s.client, "d", { spatial: {} });
    expect("error" in res).toBe(true);
    expect(s.log).not.toContain("documents.update");
    expect(s.db.documents[0].extracted).toEqual({ grantor: "Smith" });
  });
});

describe("uploadErrorCopy", () => {
  it("never shows storage or protocol text, and says what to do", () => {
    expect(uploadErrorCopy("a.pdf", "The object exceeded the maximum allowed size")).toBe(
      "a.pdf is too large to upload. Split it into smaller files and upload each one; scans work best under 100 pages per file."
    );
    expect(uploadErrorCopy("a.pdf", "tus: unexpected response while creating upload, response code: 413")).toMatch(/too large to upload/);
    expect(uploadErrorCopy("a.pdf", "Not signed in.")).toMatch(/signed out/);
    expect(uploadErrorCopy("a.pdf", "new row violates row-level security policy")).toMatch(/do not have access/);
    expect(uploadErrorCopy("a.pdf", "Failed to fetch")).toMatch(/Check your connection/);
    const odd = uploadErrorCopy("a.pdf", "tus: failed to resume upload, caused by [object ProgressEvent]");
    expect(odd).toBe("Could not upload a.pdf. Check your connection and try again.");
    for (const text of [odd, uploadErrorCopy("a.pdf", "Raise the limit in Supabase")]) {
      expect(text).not.toMatch(/tus|supabase|ProgressEvent/i);
    }
  });
});
