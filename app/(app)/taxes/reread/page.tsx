import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import RereadClient, { type RereadFile } from "./RereadClient";

export const metadata = { title: "Re-read bills" };

// Lists every stored bill file with the statement lines it carries, for
// the value re-read (migration 0050, lib/taxReread.ts).

export default async function RereadPage() {
  const { supabase } = await requireOrg();
  const [{ data: statements }, { data: docs }, { data: lines }, { data: parcels }] = await Promise.all([
    supabase.from("tax_statements").select("id, tax_year, county, source_document_id"),
    supabase.from("documents").select("id, storage_path, file_name, content_type").eq("entity_type", "tax_statement"),
    supabase.from("tax_statement_lines").select("id, tax_statement_id, tax_year, tax_due, identifiers, parcel_id, values_read_at, line_type"),
    supabase.from("parcels").select("id, parcel_number"),
  ]);
  const docById = new Map((docs ?? []).map((d) => [d.id, d]));
  const parcelNo = new Map((parcels ?? []).map((p) => [p.id, p.parcel_number]));
  const byPath = new Map<string, RereadFile & { statements: number; years: Set<number>; counties: Set<string> }>();
  for (const s of statements ?? []) {
    const d = s.source_document_id ? docById.get(s.source_document_id) : null;
    if (!d) continue;
    const f =
      byPath.get(d.storage_path) ??
      { storagePath: d.storage_path, fileName: d.file_name, contentType: d.content_type, label: "", lines: [] as RereadFile["lines"], statements: 0, years: new Set<number>(), counties: new Set<string>() };
    f.statements++;
    f.years.add(s.tax_year);
    if (s.county) f.counties.add(s.county);
    for (const l of (lines ?? []).filter((x) => x.tax_statement_id === s.id && x.line_type !== "personal_property")) {
      const ids = (l.identifiers as Array<{ kind: string; value: string }>) ?? [];
      f.lines.push({
        id: l.id,
        tax_year: l.tax_year,
        tax_due: Number(l.tax_due),
        identifiers: ids,
        valuesRead: !!l.values_read_at,
        parcelLabel: (l.parcel_id ? parcelNo.get(l.parcel_id) : null) ?? ids.find((i) => i.kind === "parcel_number")?.value ?? ids[0]?.value ?? "",
      });
    }
    byPath.set(d.storage_path, f);
  }
  const files: RereadFile[] = Array.from(byPath.values())
    .map((f) => ({
      storagePath: f.storagePath,
      fileName: f.fileName,
      contentType: f.contentType,
      label: `${Array.from(f.counties).join(", ") || "County"} ${Array.from(f.years).sort().join(", ")}${f.statements > 1 ? `, ${f.statements} statements` : ""}`,
      lines: f.lines,
    }))
    .filter((f) => f.lines.length > 0)
    .sort((a, b) => b.label.localeCompare(a.label));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <p className="text-sm text-gray-500">
          <Link href="/taxes" className="hover:underline">
            Property taxes
          </Link>{" "}
          /{" "}
          <Link href="/taxes/report" className="hover:underline">
            Tax report
          </Link>{" "}
          /
        </p>
        <h1 className="text-xl font-semibold text-gray-900">Re-read bills for their values</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-gray-600">
          Alabama bills print a market value and a current use value, plus land, buildings, the assessment ratio, the tax
          district, and the millage. The first upload kept only one of those values, and not always the same one. Reading each
          file again fills them in, so the report can show value history and what current use saves. You review each file
          before anything is saved; tax amounts and parcel matches are not changed.
        </p>
      </div>
      <RereadClient files={files} />
    </div>
  );
}
