// Big PDFs for /api/extract: the model reads a bounded number of pages
// per request, so long scans are split into sub-PDFs (page copies via
// pdf-lib) and either the first chunk is used (classification, single
// record scans) or every chunk is read and merged (FSA-156EZ packets,
// one farm per page group).

import { PDFDocument } from "pdf-lib";

export interface ChunkOptions {
  maxPages?: number; // pages per chunk
  maxBytes?: number; // soft byte cap per chunk (halves the page count until under)
}

const DEFAULT_MAX_PAGES = 90;
// Anthropic caps a request at 32 MB AFTER base64 (x1.33), so raw PDF
// bytes per call stay under 18 MB.
const DEFAULT_MAX_BYTES = 18 * 1024 * 1024;
export const MODEL_PDF_MAX_BYTES = DEFAULT_MAX_BYTES;

export async function pageCount(buffer: Buffer | Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

// Split into sub-PDFs of at most maxPages pages; a chunk that still
// exceeds maxBytes is re-split at half the page count (down to 1 page).
export async function splitPdf(
  buffer: Buffer | Uint8Array,
  opts: ChunkOptions = {}
): Promise<Buffer[]> {
  const maxPages = Math.max(1, opts.maxPages ?? DEFAULT_MAX_PAGES);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= maxPages && buffer.byteLength <= maxBytes) {
    return [Buffer.from(buffer)];
  }
  const out: Buffer[] = [];
  let start = 0;
  let size = maxPages;
  while (start < total) {
    const end = Math.min(total, start + size);
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const part = await PDFDocument.create();
    const pages = await part.copyPages(src, indices);
    for (const p of pages) part.addPage(p);
    const bytes = Buffer.from(await part.save({ useObjectStreams: true }));
    if (bytes.byteLength > maxBytes && size > 1) {
      // Too heavy (image-scanned pages): retry this range at half size.
      size = Math.max(1, Math.floor(size / 2));
      continue;
    }
    out.push(bytes);
    start = end;
  }
  return out;
}

// First N pages only (classification, single-record scans).
// First n pages, halving n until the slice fits the model's byte cap
// (scanned packets run several MB per page).
export async function firstPages(
  buffer: Buffer | Uint8Array,
  n: number,
  maxBytes: number = DEFAULT_MAX_BYTES
): Promise<{ bytes: Buffer; pages: number; total: number }> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= n && buffer.byteLength <= maxBytes) {
    return { bytes: Buffer.from(buffer), pages: total, total };
  }
  let count = Math.min(n, total);
  for (;;) {
    const part = await PDFDocument.create();
    const pages = await part.copyPages(src, Array.from({ length: count }, (_, i) => i));
    for (const p of pages) part.addPage(p);
    const bytes = Buffer.from(await part.save({ useObjectStreams: true }));
    if (bytes.byteLength <= maxBytes || count === 1) return { bytes, pages: count, total };
    count = Math.max(1, Math.floor(count / 2));
  }
}
