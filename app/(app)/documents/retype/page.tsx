import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import type { DocumentRow } from "@/types/db";
import RetypeClient from "./RetypeClient";

export const metadata = { title: "Type documents" };

// Backfill screen: every document still typed "other" (including all
// documents uploaded before the vault existed), re-typed in bulk with
// AI suggestions the user confirms.
export default async function RetypePage() {
  const { supabase } = await requireOrg();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("doc_type", "other")
    .order("created_at", { ascending: false });
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <p className="text-sm text-gray-500">
        <Link href="/documents" className="hover:underline">&larr; Documents</Link>
      </p>
      <RetypeClient docs={(data as DocumentRow[]) ?? []} />
    </div>
  );
}
