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

// Merge and delete are restructuring tools: org owners only (the UI is
// hidden for members; this is the server-side backstop).
async function requireOwner() {
  const context = await requireOrg();
  if (context.profile.role !== "owner") {
    throw new Error("Only organization owners can do that.");
  }
  return context;
}

export async function deleteEntity(formData: FormData) {
  const { supabase } = await requireOwner();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Documents have no foreign keys, so clean up the entity's document
  // rows and storage files rather than orphaning them. Properties
  // detach via the set-null FK (never deleted); aliases cascade.
  const { data: docs } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("entity_type", "entity")
    .eq("entity_id", id);
  if (docs && docs.length > 0) {
    await supabase.storage
      .from("documents")
      .remove(docs.map((d) => d.storage_path));
    await supabase
      .from("documents")
      .delete()
      .eq("entity_type", "entity")
      .eq("entity_id", id);
  }

  await supabase.from("entities").delete().eq("id", id);
  revalidatePath("/entities");
  revalidatePath("/properties");
  redirect("/entities");
}

// Move the source entity's properties, aliases, and documents to the
// target, then remove the source. Alias uniqueness is per organization
// (not per entity), so the move cannot collide. Storage paths key on
// entity_type, not the entity id, so moved documents keep their files.
export async function mergeEntity(formData: FormData) {
  const { supabase } = await requireOwner();
  const sourceId = String(formData.get("source_id") ?? "");
  const targetId = String(formData.get("target_id") ?? "");
  if (!sourceId || !targetId || sourceId === targetId) return;

  const steps = [
    supabase
      .from("properties")
      .update({ entity_id: targetId })
      .eq("entity_id", sourceId),
    supabase
      .from("entity_aliases")
      .update({ entity_id: targetId })
      .eq("entity_id", sourceId),
    supabase
      .from("documents")
      .update({ entity_id: targetId })
      .eq("entity_type", "entity")
      .eq("entity_id", sourceId),
  ];
  for (const step of steps) {
    const { error } = await step;
    if (error) throw new Error("Merge failed: " + error.message);
  }
  await supabase.from("entities").delete().eq("id", sourceId);

  revalidatePath("/entities");
  revalidatePath("/properties");
  redirect(`/entities/${targetId}`);
}
