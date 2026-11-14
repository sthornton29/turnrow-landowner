// Bulk document upload: the decisions behind each row of the batch
// review table, kept pure so they are unit tested. The browser flow is
// components/documents/intake/BatchIntake.tsx.

// Storage object names: Supabase Storage rejects keys with characters
// such as % # ? and most non-ASCII, which made files like
// "Deed - Marital Trust 5.88% Interest.pdf" fail with "Bad Request".
// The original name is kept on documents.file_name; only the key is
// made safe.
export function safeStorageName(fileName: string): string {
  const cleaned = fileName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._() ,&'-]+/g, "_")
    .replace(/_+/g, "_")
    .trim();
  return cleaned === "" || cleaned === "." ? "file" : cleaned;
}

// Files the intake AI can read. Word files and anything else still
// upload; the user picks the type and property.
export function aiReadable(fileName: string, contentType: string | null | undefined): boolean {
  const t = (contentType ?? "").toLowerCase();
  if (t === "application/pdf" || t.startsWith("image/")) return true;
  return /\.(pdf|png|jpe?g|gif|webp|tiff?|heic|csv|xlsx|xls)$/i.test(fileName);
}

// Same name and size as a document already in Turnrow: almost surely
// the same file dropped again.
export function duplicateKey(fileName: string, size: number): string {
  return `${fileName.trim().toLowerCase()}|${size}`;
}

// The same file dropped again, even renamed with a prefix ("004
// Warranty deed - Smith deed.pdf" for "Smith deed.pdf"): identical size
// and the new name ends with the stored name.
// Returns the existing document's id, or null.
export function buildDuplicateIndex(docs: Array<{ id?: string; file_name: string; size_bytes: number | null }>) {
  const bySize = new Map<number, Array<{ id: string; name: string }>>();
  for (const d of docs) {
    if (d.size_bytes == null) continue;
    const n = Number(d.size_bytes);
    bySize.set(n, [...(bySize.get(n) ?? []), { id: d.id ?? "", name: d.file_name.trim().toLowerCase() }]);
  }
  return (fileName: string, size: number): string | null => {
    const name = fileName.trim().toLowerCase();
    const hit = (bySize.get(size) ?? []).find((e) => name === e.name || name.endsWith(e.name));
    return hit ? hit.id : null;
  };
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// A folder in the dropped path named after a property (or one of its
// aliases) is a strong hint: "Land Records/Cottontown/deed.pdf" belongs
// to Cottontown. The deepest matching folder wins; the file name itself
// is not used (deed names mention sellers' farms as often as ours).
export function folderProperty(
  relativePath: string | null | undefined,
  properties: Array<{ id: string; name: string; aliases?: string[] | null }>
): string | null {
  if (!relativePath) return null;
  const parts = relativePath.split(/[\\/]/).slice(0, -1).reverse();
  for (const part of parts) {
    const p = norm(part);
    if (!p) continue;
    const hit = properties.find(
      (x) => norm(x.name) === p || (x.aliases ?? []).some((a) => norm(a) === p)
    );
    if (hit) return hit.id;
  }
  return null;
}

export type BatchStatus = "ready" | "review" | "duplicate" | "elsewhere";

export interface BatchProposalInput {
  readable: boolean;
  aiError: string | null;
  docType: string | null;
  confidence: string | null;
  specializedKind: string | null;
  preselect: string[];
  conflict: boolean;
  folderPropertyId: string | null;
  contextPropertyId: string | null;
  duplicate: boolean;
  propertyName: (id: string) => string;
}

export interface BatchProposal {
  status: BatchStatus;
  propertyIds: string[];
  notes: string[];
}

const SPECIALIZED_LABEL: Record<string, string> = {
  lease: "Looks like a lease: the Leases upload reads its terms",
  timber_contract: "Looks like a timber sale contract: use Timber sales",
  timber_settlement: "Looks like a timber settlement: use the settlement upload",
  tax_statement: "Looks like a property tax bill: use Taxes > Upload",
  rent_payment: "Looks like a rent payment: use the rent upload",
};

// Which properties to pre-check and whether the row can be saved with
// the batch as is ("ready") or needs a look first.
export function proposeBatchRow(i: BatchProposalInput): BatchProposal {
  const notes: string[] = [];
  let ids = [...i.preselect];
  let review = false;

  if (i.contextPropertyId && !ids.includes(i.contextPropertyId)) ids = [i.contextPropertyId, ...ids];

  if (i.folderPropertyId) {
    if (ids.length === 0) {
      ids = [i.folderPropertyId];
      notes.push(`Property from the folder name (${i.propertyName(i.folderPropertyId)})`);
    } else if (!ids.includes(i.folderPropertyId)) {
      notes.push(
        `Folder says ${i.propertyName(i.folderPropertyId)}; the document points to ${ids.map(i.propertyName).join(", ")}`
      );
      ids = [...ids, i.folderPropertyId];
      review = true;
    }
  }

  if (!i.readable) {
    notes.push("The AI does not read this file type; check the type");
    review = true;
  } else if (i.aiError) {
    notes.push(`Could not be read: ${i.aiError}`);
    review = true;
  } else {
    if (i.conflict) {
      notes.push("Its parcel numbers and its land description point to different properties");
      review = true;
    }
    if ((i.confidence ?? "").toLowerCase() === "low" || !i.docType || i.docType === "other") {
      notes.push("Unsure what kind of document this is");
      review = true;
    }
  }
  if (ids.length === 0) {
    notes.push("No property found");
    review = true;
  }

  if (i.duplicate) {
    // Nothing else matters for a file that is already saved.
    return { status: "duplicate", propertyIds: ids, notes: ["Already in Turnrow (same file). Check it to save a second copy."] };
  }
  if (i.specializedKind && SPECIALIZED_LABEL[i.specializedKind]) {
    return { status: "elsewhere", propertyIds: ids, notes: [SPECIALIZED_LABEL[i.specializedKind], ...notes] };
  }
  return { status: review ? "review" : "ready", propertyIds: ids, notes };
}

// Runs fn over items with at most `limit` in flight, in order. When
// shouldStop is given it is asked before each item starts: once it says
// yes, nothing further starts (items already running finish). The
// batch save uses it so a closed dialog stops saving the rest.
export async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      if (shouldStop?.()) return;
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}
