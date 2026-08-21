import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import type { DocumentRow } from "@/types/db";
import TitlesReviewClient from "./TitlesReviewClient";

export const metadata = { title: "Review document titles" };

// One-time backfill review: every document whose title has not been
// looked at since titles became the display name (migration 0028).
// Proposals come from the extracted fields (lib/documentTitle.ts).
export default async function TitlesReviewPage() {
  const { supabase } = await requireOrg();
  const [docs, links, properties] = await Promise.all([
    supabase.from("documents").select("*").eq("title_reviewed", false).order("created_at", { ascending: false }),
    supabase.from("document_properties").select("document_id, property_id"),
    supabase.from("properties").select("id, name"),
  ]);
  const nameById = new Map((properties.data ?? []).map((p) => [p.id, p.name as string]));
  const firstProperty: Record<string, string> = {};
  for (const l of links.data ?? []) {
    if (!firstProperty[l.document_id]) {
      const n = nameById.get(l.property_id);
      if (n) firstProperty[l.document_id] = n;
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <p className="text-sm text-gray-500">
        <Link href="/documents" className="hover:underline">&larr; Documents</Link>
      </p>
      <TitlesReviewClient docs={(docs.data as DocumentRow[]) ?? []} firstProperty={firstProperty} />
    </div>
  );
}
