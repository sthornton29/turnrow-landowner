// Protest packet PDF for one parcel: cover letter draft, the grounds, the
// county's record, value and tax history, comparables, the current use
// table, and a filing checklist. jsPDF direct-draw in the print system's
// style (same as taxReportPdf.ts); every number comes from
// lib/protestPacket.ts.
import { jsPDF } from "jspdf";
import { loadLockupPng } from "@/components/map/printPdf";
import type { ProtestPacket } from "@/lib/protestPacket";

const PAGE = { w: 215.9, h: 279.4 }; // Letter portrait, mm
const MARGIN = 14;
const CONTENT_W = PAGE.w - MARGIN * 2;
const PINE: [number, number, number] = [20, 83, 45];
const GRAY: [number, number, number] = [90, 90, 90];
const INK: [number, number, number] = [35, 35, 35];

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const cents = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generateProtestPacketPdf(pk: ProtestPacket): Promise<void> {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  let y = 18;

  const ensureRoom = (needed: number) => {
    if (y + needed > PAGE.h - 20) {
      pdf.addPage();
      y = 18;
    }
  };
  const heading = (t: string) => {
    ensureRoom(14);
    y += 2;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(...PINE);
    pdf.text(t, MARGIN, y);
    y += 5.5;
  };
  const para = (t: string, size = 9, indent = 0, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...INK);
    for (const chunk of t.split("\n")) {
      const lines = pdf.splitTextToSize(chunk, CONTENT_W - indent);
      const lh = size * 0.42;
      ensureRoom(lines.length * lh + 1);
      pdf.text(lines, MARGIN + indent, y);
      y += lines.length * lh + 0.6;
    }
    y += 1.6;
  };
  const table = (cols: Array<{ label: string; w: number; right?: boolean }>, rows: string[][]) => {
    const row = (cells: string[], bold: boolean) => {
      ensureRoom(5);
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(bold ? 7 : 8);
      pdf.setTextColor(...(bold ? GRAY : INK));
      let x = MARGIN;
      cols.forEach((c, i) => {
        const text = pdf.splitTextToSize(cells[i] ?? "", c.w - 2)[0] ?? "";
        pdf.text(text, c.right ? x + c.w - 1 : x, y, c.right ? { align: "right" } : undefined);
        x += c.w;
      });
      y += 4.2;
      if (bold) {
        pdf.setDrawColor(210, 210, 210);
        pdf.line(MARGIN, y - 2.8, MARGIN + CONTENT_W, y - 2.8);
      }
    };
    row(cols.map((c) => c.label.toUpperCase()), true);
    for (const r of rows) row(r, false);
    y += 2;
  };

  // ---- Title block ----
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(...PINE);
  pdf.text("Property Tax Protest Packet", MARGIN, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...GRAY);
  pdf.text(`Prepared ${pk.preparedOn}`, PAGE.w - MARGIN, y, { align: "right" });
  y += 6;
  pdf.setFontSize(10);
  pdf.setTextColor(...INK);
  pdf.text(`Parcel ${pk.parcelNumber} · ${pk.county} County${pk.propertyName ? ` · ${pk.propertyName}` : ""} · ${pk.owner}`, MARGIN, y);
  y += 5;
  if (pk.deadline) {
    pdf.setFillColor(254, 226, 226);
    pdf.roundedRect(MARGIN, y, CONTENT_W, 9, 1.5, 1.5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    pdf.setTextColor(153, 27, 27);
    pdf.text(`File by ${pk.deadline.date} (30 days from the valuation notice dated ${pk.deadline.noticeDate}).`, MARGIN + 3, y + 6);
    y += 13;
  } else {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...GRAY);
    pdf.text("A protest is due within 30 days of the county's valuation notice.", MARGIN, y + 2);
    y += 7;
  }

  // ---- Grounds summary ----
  heading("Grounds");
  if (pk.grounds.length === 0) {
    para("The tax report found nothing specific on this parcel. The facts below are the county's own record; add the reasons for the protest to the letter.");
  } else {
    for (const g of pk.grounds) {
      para(
        `${g.heading}${g.dollars ? ` (about ${money(Math.round(g.dollars / 10) * 10)} a year)` : ""}${
          g.forWhom === "assessor" ? " · raise with the revenue commissioner" : " · for the Board of Equalization"
        }`,
        9,
        0,
        true
      );
      y -= 1.2;
      para(g.text, 8.5, 3);
    }
  }

  // ---- The county's record ----
  heading("The parcel, from the county record and the bills");
  const half = Math.ceil(pk.facts.length / 2);
  const colW = CONTENT_W / 2;
  const startY = y;
  let maxY = y;
  [pk.facts.slice(0, half), pk.facts.slice(half)].forEach((group, gi) => {
    let yy = startY;
    for (const [k, v] of group) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(...GRAY);
      pdf.text(k, MARGIN + gi * colW, yy);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(...INK);
      pdf.text(pdf.splitTextToSize(v, colW * 0.48)[0] ?? "", MARGIN + gi * colW + colW * 0.5, yy);
      yy += 4.4;
    }
    maxY = Math.max(maxY, yy);
  });
  y = maxY + 2;

  // ---- History ----
  if (pk.history.length) {
    heading("Values and taxes on the bills");
    table(
      [
        { label: "Tax year", w: 30 },
        { label: "Value printed", w: 45, right: true },
        { label: "Kind", w: 60 },
        { label: "Tax", w: 40, right: true },
      ],
      pk.history.map((h) => [
        String(h.year),
        h.value ? money(h.value) : "-",
        h.kind === "market" ? "Market value (taxed on current use)" : h.kind === "taxed" ? "Value the tax was figured on" : "Not sure",
        cents(h.tax),
      ])
    );
  }

  // ---- Comparables ----
  if (pk.comparables.length) {
    heading(`The owner's other ${pk.county} County parcels`);
    para("Taxable land value per acre on the county's own records, closest in size first.", 8, 0);
    table(
      [
        { label: "Parcel", w: 48 },
        { label: "Property", w: 45 },
        { label: "Acres", w: 20, right: true },
        { label: "Land value / ac", w: 30, right: true },
        { label: "Current use", w: 45 },
      ],
      pk.comparables.map((c) => [c.parcelNumber, c.propertyName, c.acres ? c.acres.toFixed(1) : "-", money(c.landPerAcre), c.status])
    );
  }

  // ---- Current use table ----
  if (pk.cuTable && pk.cuTable.rows.length) {
    heading(`Alabama current use values, ${pk.cuTable.year} table (per acre)`);
    table(
      [
        { label: "Land", w: 50 },
        { label: "Soil rating", w: 40 },
        { label: "Value / ac", w: 30, right: true },
      ],
      pk.cuTable.rows.map((r) => [r.landType, r.rating, money(r.perAcre)])
    );
  }

  // ---- Checklist ----
  heading("Before you file");
  for (const c of pk.checklist) para(`[  ]  ${c}`, 8.5);

  // ---- Letter draft, on its own page ----
  pdf.addPage();
  y = 22;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(...PINE);
  pdf.text("Draft protest letter", MARGIN, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(...GRAY);
  pdf.text("Review, complete the blanks, and sign. Edit freely.", PAGE.w - MARGIN, y, { align: "right" });
  y += 10;
  pk.letter.forEach((p, i) => para(p, 10, 0, i < 2));

  // ---- Footer on every page ----
  const lockup = await loadLockupPng();
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    if (lockup) {
      const w = 26;
      pdf.addImage(lockup, "PNG", PAGE.w - MARGIN - w, PAGE.h - 12.5, w, w * 0.21);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(5.5);
      pdf.setTextColor(...PINE);
      pdf.text("LANDOWNER", PAGE.w - MARGIN, PAGE.h - 6.8, { align: "right", charSpace: 0.5 });
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    pdf.setTextColor(130, 130, 130);
    pdf.text(`Parcel ${pk.parcelNumber} · Page ${p} of ${pages} · Prepared from county records and bills on file; not legal advice.`, MARGIN, PAGE.h - 7);
  }

  pdf.save(`protest-packet-${pk.parcelNumber.replace(/[^0-9A-Za-z]+/g, "-")}-${pk.preparedOn}.pdf`);
}
