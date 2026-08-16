"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";

export async function createProperty(formData: FormData) {
  const { supabase, profile } = await requireOrg();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const fsaNumbers = String(formData.get("fsa_numbers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await supabase.from("properties").insert({
    organization_id: profile.organization_id,
    name,
    county: String(formData.get("county") ?? "").trim() || null,
    state: String(formData.get("state") ?? "").trim() || null,
    entity_id: String(formData.get("entity_id") ?? "").trim() || null,
    fsa_numbers: fsaNumbers.length > 0 ? fsaNumbers : null,
  });
  revalidatePath("/properties");
}
