import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { firstPages, pageCount, pageGroups, rawPageCount, slicePages, splitPdf, UnsplittablePdfError } from "./pdfChunks";

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// What a 2012 copier wrote: binary bytes on line 2, right after the
// %PDF header, which pdf-lib reads as an object and fails on ("Failed
// to parse number") while viewers and the model read the file fine.
async function makeBrokenPdf(pages: number): Promise<Buffer> {
  const good = await makePdf(pages);
  const nl = good.indexOf(0x0a);
  const junk = Buffer.from([0x0a, 0xc6, 0x31, 0x0e, 0x00, 0x12, 0x00, 0x00, 0x00, 0x19, 0x00, 0x00, 0x00, 0xa0, 0x00, 0x20, 0x00]);
  return Buffer.concat([good.subarray(0, nl), junk, good.subarray(nl)]);
}

describe("pdfChunks with a normal PDF", () => {
  it("counts and splits pages", async () => {
    const pdf = await makePdf(5);
    expect(await pageCount(pdf)).toBe(5);
    expect(await splitPdf(pdf, { maxPages: 2 })).toHaveLength(3);
    expect((await firstPages(pdf, 2)).pages).toBe(2);
    expect((await pageGroups(pdf, 2)).map((g) => g.firstPage)).toEqual([1, 3, 5]);
  });
});

describe("pdfChunks with a PDF pdf-lib cannot parse", () => {
  it("really is unparseable by pdf-lib (the bug this guards)", async () => {
    await expect(PDFDocument.load(await makeBrokenPdf(3), { ignoreEncryption: true })).rejects.toThrow();
  });

  it("passes a small file to the model whole instead of failing", async () => {
    const broken = await makeBrokenPdf(3);
    expect(await pageCount(broken)).toBe(3);
    expect(rawPageCount(broken)).toBe(3);
    const first = await firstPages(broken, 20);
    expect(first.bytes.equals(broken)).toBe(true);
    expect(first.total).toBe(3);
    expect(await splitPdf(broken, { maxPages: 1 })).toEqual([broken]);
    expect((await slicePages(broken, [2])).equals(broken)).toBe(true);
    expect(await pageGroups(broken, 1)).toEqual([{ bytes: broken, firstPage: 1, pages: 3 }]);
  });

  it("explains how to fix a file too large to send whole", async () => {
    const broken = await makeBrokenPdf(3);
    await expect(firstPages(broken, 20, 10)).rejects.toBeInstanceOf(UnsplittablePdfError);
    await expect(splitPdf(broken, { maxBytes: 10 })).rejects.toThrow(/Print to PDF/);
  });
});
