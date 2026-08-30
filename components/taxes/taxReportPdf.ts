// Tax Change Report PDF: the report Stuart hands to a CPA or attaches
// to an appeal. jsPDF direct-draw in the print system's visual style
// (pine title block, brand lockup, letter portrait); the numbers come
// verbatim from lib/taxChange.ts - nothing is recomputed here.
import { jsPDF } from "jspdf";
import { loadLockupPng } from "@/components/map/printPdf";
import { formatDollars } from "@/lib/format";
import type { TaxChangeReport } from "@/lib/taxChange";

const PAGE = { w: 215.9, h: 279.4 }; // Letter portrait, mm
const MARGIN = 12;
const CONTENT_W = PAGE.w - MARGIN * 2;
const PINE: [number, number, number] = [20, 83, 45];
const GRAY: [number, number, number] = [90, 90, 90];

export interface TaxReportJob {
  report: TaxChangeReport;
  scopeLine: string; // years, entities, county, threshold
}

const pctText = (fraction: number | null) =>
  fraction == null ? "" : `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(1)}%`;

export async function generateTaxReportPdf(job: TaxReportJob): Promise<void> {
  const { report } = job;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  let y = 16;

  const ensureRoom = (needed: number) => {
    if (y + needed > PAGE.h - 18) {
      pdf.addPage();
      y = 16;
    }
  };

  // ---- Title block (the print system's style) ----
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(...PINE);
  pdf.text("Property Tax Change Report", MARGIN, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(...GRAY);
  pdf.text(new Date().toLocaleDateString(), PAGE.w - MARGIN, y, { align: "right" });
  y += 6;
  pdf.setFontSize(9);
  pdf.text(job.scopeLine, MARGIN, y);
  y += 8;

  // ---- Summary cards ----
  const cards = [
    {
      label: `Total tax, ${report.y0} to ${report.y1}`,
      value: `${formatDollars(report.summary.tax0)} to ${formatDollars(report.summary.tax1)}`,
      note: pctText(report.summary.taxPct),
    },
    {
      label: `Appraised value, ${report.y0} to ${report.y1}`,
      value: `${formatDollars(report.summary.appraised0)} to ${formatDollars(report.summary.appraised1)}`,
      note: pctText(report.summary.appraisedPct),
    },
    {
      label: "Parcels compared",
      value: String(report.summary.comparedParcels),
      note: "",
    },
    {
      label: "Parcels flagged",
      value: String(report.summary.flaggedParcels),
      note: report.summary.flaggedParcels > 0 ? "see Flags" : "",
    },
  ];
  const cardW = (CONTENT_W - 3 * 4) / 4;
  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardW + 4);
    pdf.setDrawColor(210, 210, 210);
    pdf.setFillColor(248, 248, 248);
    pdf.roundedRect(x, y, cardW, 20, 1.5, 1.5, "FD");
    pdf.setFontSize(6.5);
    pdf.setTextColor(...GRAY);
    pdf.text(pdf.splitTextToSize(card.label.toUpperCase(), cardW - 4), x + 2, y + 4);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...PINE);
    pdf.text(pdf.splitTextToSize(card.value, cardW - 4), x + 2, y + 11.5);
    pdf.setFont("helvetica", "normal");
    if (card.note) {
      pdf.setFontSize(7);
      pdf.setTextColor(...GRAY);
      pdf.text(card.note, x + 2, y + 18);
    }
  });
  y += 26;

  // ---- Trend: two small bar charts, separate scales (honest) ----
  const chart = (
    x: number,
    w: number,
    title: string,
    values: Array<{ year: number; value: number }>
  ) => {
    const h = 30;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(60, 60, 60);
    pdf.text(title, x, y);
    const top = y + 3;
    const max = Math.max(1, ...values.map((v) => v.value));
    const slot = w / Math.max(1, values.length);
    const barW = Math.min(14, slot * 0.6);
    values.forEach((v, i) => {
      const bh = (v.value / max) * (h - 8);
      const bx = x + i * slot + (slot - barW) / 2;
      pdf.setFillColor(...PINE);
      pdf.rect(bx, top + (h - 8) - bh, barW, Math.max(bh, 0.3), "F");
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6);
      pdf.setTextColor(...GRAY);
      pdf.text(formatDollars(v.value), bx + barW / 2, top + (h - 8) - bh - 1, {
        align: "center",
      });
      pdf.setTextColor(60, 60, 60);
      pdf.text(String(v.year), bx + barW / 2, top + h - 3, { align: "center" });
    });
  };
  const halfW = (CONTENT_W - 8) / 2;
  chart(MARGIN, halfW, "Total tax by year", report.perYear.map((p) => ({ year: p.year, value: p.totalTax })));
  chart(MARGIN + halfW + 8, halfW, "Total appraised value by year", report.perYear.map((p) => ({ year: p.year, value: p.totalAppraised })));
  y += 38;

  // ---- Biggest movers ----
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(...PINE);
  pdf.text("Biggest movers", MARGIN, y);
  y += 5;
  pdf.setFontSize(7);
  pdf.setTextColor(...GRAY);
  pdf.setFont("helvetica", "bold");
  const cols = [
    { label: "Parcel", x: MARGIN, w: 44 },
    { label: "Appraised", x: MARGIN + 46, w: 42 },
    { label: "Tax", x: MARGIN + 90, w: 34 },
    { label: "Eff. rate", x: MARGIN + 126, w: 24 },
    { label: "What moved it", x: MARGIN + 152, w: CONTENT_W - 152 },
  ];
  for (const c of cols) pdf.text(c.label, c.x, y);
  y += 1.5;
  pdf.setDrawColor(180, 180, 180);
  pdf.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 3.5;
  pdf.setFont("helvetica", "normal");

  const rateText = (r: number | null) => (r == null ? "" : `${(r * 100).toFixed(3)}%`);
  for (const m of report.movers) {
    const sentence = m.sentence ?? (m.deltaTax != null ? `Tax changed ${formatDollars(m.deltaTax)} (no appraised values to decompose).` : "");
    const flagNote = m.flags.length > 0 ? ` [${m.flags.map((f) => f.kind.replace("_", " ")).join(", ")}]` : "";
    const sentenceLines = pdf.splitTextToSize(sentence + flagNote, cols[4].w);
    const rowH = Math.max(7, sentenceLines.length * 3 + 4);
    ensureRoom(rowH);
    pdf.setFontSize(7);
    pdf.setTextColor(40, 40, 40);
    pdf.text(pdf.splitTextToSize(m.parcelNumber, cols[0].w), cols[0].x, y);
    pdf.text(
      m.y0?.appraised != null && m.y1?.appraised != null
        ? `${formatDollars(m.y0.appraised)} > ${formatDollars(m.y1.appraised)}`
        : "",
      cols[1].x,
      y
    );
    pdf.text(
      `${formatDollars(m.y0?.taxDue ?? 0)} > ${formatDollars(m.y1?.taxDue ?? 0)}`,
      cols[2].x,
      y
    );
    pdf.text(
      m.rate0 != null || m.rate1 != null
        ? `${rateText(m.rate0)} > ${rateText(m.rate1)}`
        : "",
      cols[3].x,
      y
    );
    pdf.text(sentenceLines, cols[4].x, y);
    y += rowH;
  }
  if (report.movers.length === 0) {
    ensureRoom(6);
    pdf.setFontSize(8);
    pdf.setTextColor(...GRAY);
    pdf.text("No parcels have lines in both years of the range.", MARGIN, y);
    y += 6;
  }
  y += 4;

  // ---- Flags ----
  if (report.flagged.length > 0) {
    ensureRoom(12);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(...PINE);
    pdf.text("Flags", MARGIN, y);
    y += 5;
    const order = ["ratio_shift", "exemption_change", "spike", "disappeared", "appeared"] as const;
    const headings: Record<(typeof order)[number], string> = {
      ratio_shift: "Assessment ratio shifts (check with the revenue commissioner)",
      exemption_change: "Exemption changes",
      spike: "Value spikes (appeal-review candidates)",
      disappeared: "Missing this year",
      appeared: "New this year",
    };
    for (const kind of order) {
      const rows = report.flagged.flatMap((c) =>
        c.flags.filter((f) => f.kind === kind).map((f) => ({ parcel: c.parcelNumber, message: f.message }))
      );
      if (rows.length === 0) continue;
      ensureRoom(10);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(60, 60, 60);
      pdf.text(headings[kind], MARGIN, y);
      y += 4;
      pdf.setFont("helvetica", "normal");
      for (const row of rows) {
        const lines = pdf.splitTextToSize(`${row.parcel}: ${row.message}`, CONTENT_W - 4);
        ensureRoom(lines.length * 3.2 + 2);
        pdf.setFontSize(7.5);
        pdf.setTextColor(40, 40, 40);
        pdf.text(lines, MARGIN + 2, y);
        y += lines.length * 3.2 + 2;
      }
      y += 2;
    }
  }

  // ---- Brand lockup on every page ----
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
    } else {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(...PINE);
      pdf.text("TURNROW LANDOWNER", PAGE.w - MARGIN, PAGE.h - 8, { align: "right" });
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    pdf.setTextColor(130, 130, 130);
    pdf.text(`Page ${p} of ${pages}`, MARGIN, PAGE.h - 7);
  }

  const date = new Date().toISOString().slice(0, 10);
  pdf.save(`tax-change-report-${report.y0}-${report.y1}-${date}.pdf`);
}
