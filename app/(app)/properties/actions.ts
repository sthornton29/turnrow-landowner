"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";

export async function createProperty(formData: FormData) {
  const { supabase, profile } = await requireOrg();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await supabase.from("properties").insert({
    organization_id: profile.organization_id,
    name,
    county: String(formData.get("county") ?? "").trim() || null,
    state: String(formData.get("state") ?? "").trim() || null,
  });
  revalidatePath("/properties");
}

export async function deleteProperty(formData: FormData) {
  const { supabase } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Parcels and fields under it are removed by the cascading foreign keys.
  await supabase.from("properties").delete().eq("id", id);
  revalidatePath("/properties");
  redirect("/properties");
}
