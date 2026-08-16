"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";

export async function createEntity(formData: FormData) {
  const { supabase, profile } = await requireOrg();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await supabase.from("entities").insert({
    organization_id: profile.organization_id,
    name,
    entity_type: String(formData.get("entity_type") ?? "other"),
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  revalidatePath("/entities");
}

export async function deleteEntity(formData: FormData) {
  const { supabase } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Properties are detached (entity_id set null), never deleted; the
  // entity's saved county-name aliases go with it.
  await supabase.from("entities").delete().eq("id", id);
  revalidatePath("/entities");
  revalidatePath("/properties");
  redirect("/entities");
}
