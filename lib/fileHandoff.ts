"use client";

// Hands a File from the document intake to a specialized flow (lease,
// timber sale, tax statement, rent upload) on another page. Files do
// not survive navigation in React state, so the file is parked in
// IndexedDB under a one-time key; the receiving page takes it (which
// deletes it) and feeds it into its existing file handler as if the
// user had chosen it there. Nothing is saved server-side by the handoff.

const DB = "turnrow-handoff";
const STORE = "files";
const TTL_MS = 10 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putHandoffFile(file: File): Promise<string> {
  const key = crypto.randomUUID();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ file, name: file.name, type: file.type, at: Date.now() }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return key;
}

// Returns the parked file (and removes it) or null when missing/expired.
export async function takeHandoffFile(key: string): Promise<File | null> {
  try {
    const db = await openDb();
    const record = await new Promise<{ file: File; name: string; type: string; at: number } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const get = store.get(key);
        get.onsuccess = () => {
          store.delete(key);
          resolve(get.result as { file: File; name: string; type: string; at: number } | undefined);
        };
        get.onerror = () => reject(get.error);
      }
    );
    db.close();
    if (!record || Date.now() - record.at > TTL_MS) return null;
    const f = record.file;
    // Some browsers return a Blob; rewrap as a File so name/type survive.
    return f instanceof File ? f : new File([f], record.name, { type: record.type });
  } catch {
    return null;
  }
}

// Routes per specialized kind; the receiving client picks the file up
// from ?handoff=<key> on load.
export const HANDOFF_ROUTES: Record<string, { href: string; label: string }> = {
  lease: { href: "/leases/new", label: "Open in Leases" },
  timber_contract: { href: "/timber-sales/new", label: "Open in Timber sales" },
  timber_settlement: { href: "/income", label: "Open in Rent and settlement upload" },
  tax_statement: { href: "/taxes/upload", label: "Open in Property Taxes" },
  rent_payment: { href: "/income", label: "Open in Rent upload" },
};
