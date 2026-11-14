"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { friendlyDbError, NO_ACCESS_MESSAGE } from "@/lib/dbErrors";

// What a form action hands back to its form: a plain sentence when it
// did not go through (the form keeps what was typed), nothing otherwise.
export type EntityActionState = { error: string | null; ok?: boolean };

export async function createEntity(
  _prev: EntityActionState,
  formData: FormData
): Promise<EntityActionState> {
  const { supabase, profile } = await requireOrg();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the entity a name." };

  const { error } = await supabase.from("entities").insert({
    organization_id: profile.organization_id,
    name,
    entity_type: String(formData.get("entity_type") ?? "other"),
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) return { error: friendlyDbError(error, "The entity was not created. Please try again.") };
  revalidatePath("/entities");
  return { error: null, ok: true };
}

export async function deleteEntity(
  _prev: EntityActionState,
  formData: FormData
): Promise<EntityActionState> {
  // Merge and delete are restructuring tools: admins only (the UI is
  // hidden for users; this is the server-side backstop).
  const { supabase, isAdmin } = await requireOrg();
  if (!isAdmin) return { error: NO_ACCESS_MESSAGE };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "That entity was not found." };

  // Documents have no foreign keys, so clean up the entity's document
  // rows and storage files rather than orphaning them. Properties
  // detach via the set-null FK (never deleted); aliases cascade. The
  // same delete also, by foreign key, clears the entity on tax
  // statements, timber basis accounts, cost-share awards, and income
  // records, and removes its registered tax accounts and member access
  // (the confirmation in EntityDangerZone lists all of it).
  const { data: docs, error: docsError } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("entity_type", "entity")
    .eq("entity_id", id);
  if (docsError) {
    return { error: friendlyDbError(docsError, "Could not read this entity's documents, so nothing was deleted. Please try again.") };
  }
  if (docs && docs.length > 0) {
    const { error: filesError } = await supabase.storage
      .from("documents")
      .remove(docs.map((d) => d.storage_path));
    if (filesError) {
      return { error: "This entity's document files could not be removed, so nothing was deleted. Please try again." };
    }
    const { error: rowsError } = await supabase
      .from("documents")
      .delete()
      .eq("entity_type", "entity")
      .eq("entity_id", id);
    if (rowsError) {
      return { error: friendlyDbError(rowsError, "This entity's documents could not be removed, so the entity was not deleted. Please try again.") };
    }
  }

  const { error } = await supabase.from("entities").delete().eq("id", id);
  if (error) return { error: friendlyDbError(error, "The entity was not deleted. Please try again.") };
  revalidatePath("/entities");
  revalidatePath("/properties");
  redirect("/entities");
}

// Move EVERYTHING that hangs on the source entity to the target, then
// remove the source. Deleting an entity clears or deletes, by foreign
// key, far more than its properties, so each of these moves first:
//   properties.entity_id         (0009, set null)
//   entity_aliases.entity_id     (0007/0009, cascade)
//   documents (entity_type 'entity'; no foreign key)
//   tax_statements.entity_id     (0030:42-46, set null)
//   entity_accounts.entity_id    (0030:208-209, cascade)
//   timber_accounts.entity_id    (0046:58-59, set null)
//   cost_share_awards.entity_id  (0047:49-50, set null)
//   income_records.entity_id     (0051:44-45, set null)
//   entity_access                (0034:96-97, cascade): members who had
//                                the source get the target instead
// Every step is checked and the merge stops BEFORE the delete when one
// fails; each move is safe to run again, so retrying finishes the job.
// Alias uniqueness is per organization (not per entity), and so is a
// registered tax account's (county, state, account number): neither
// move can collide with a row the target already has. Storage paths key
// on entity_type, not the entity id, so moved documents keep their files.
export async function mergeEntity(
  _prev: EntityActionState,
  formData: FormData
): Promise<EntityActionState> {
  // Admins only (the UI is hidden for users; this is the backstop).
  const { supabase, profile, isAdmin } = await requireOrg();
  if (!isAdmin) return { error: NO_ACCESS_MESSAGE };
  const sourceId = String(formData.get("source_id") ?? "");
  const targetId = String(formData.get("target_id") ?? "");
  if (!sourceId || !targetId || sourceId === targetId) {
    return { error: "Pick the entity to merge into." };
  }

  const { data: both, error: readError } = await supabase
    .from("entities")
    .select("id")
    .in("id", [sourceId, targetId]);
  if (readError || (both ?? []).length !== 2) {
    return {
      error: readError
        ? friendlyDbError(readError, "Could not read the two entities, so nothing was changed. Please try again.")
        : "One of the two entities was not found, so nothing was changed. Reload the page and try again.",
    };
  }

  // Says where it stopped, that nothing was deleted, and why in plain words.
  const stopped = (what: string, error: { code?: string; message: string }) =>
    `The merge stopped at ${what}, and nothing was deleted. ${friendlyDbError(error, "Try the merge again to finish it.")}`;

  const steps: Array<[string, PromiseLike<{ error: { code?: string; message: string } | null }>]> = [
    ["the properties", supabase.from("properties").update({ entity_id: targetId }).eq("entity_id", sourceId)],
    ["the saved county spellings", supabase.from("entity_aliases").update({ entity_id: targetId }).eq("entity_id", sourceId)],
    [
      "the documents",
      supabase.from("documents").update({ entity_id: targetId }).eq("entity_type", "entity").eq("entity_id", sourceId),
    ],
    ["the tax statements", supabase.from("tax_statements").update({ entity_id: targetId }).eq("entity_id", sourceId)],
    ["the registered tax accounts", supabase.from("entity_accounts").update({ entity_id: targetId }).eq("entity_id", sourceId)],
    ["the timber basis accounts", supabase.from("timber_accounts").update({ entity_id: targetId }).eq("entity_id", sourceId)],
    ["the cost-share awards", supabase.from("cost_share_awards").update({ entity_id: targetId }).eq("entity_id", sourceId)],
    ["the income records", supabase.from("income_records").update({ entity_id: targetId }).eq("entity_id", sourceId)],
  ];
  for (const [what, step] of steps) {
    const { error } = await step;
    if (error) return { error: stopped(what, error) };
  }

  // Member access: everyone granted the source gets the target, unless
  // they already have it (one grant per member and entity). The source's
  // own grants go with it when it is deleted below.
  const { data: grants, error: grantsError } = await supabase
    .from("entity_access")
    .select("user_id, entity_id")
    .in("entity_id", [sourceId, targetId]);
  if (grantsError) return { error: stopped("member access", grantsError) };
  const hasTarget = new Set((grants ?? []).filter((g) => g.entity_id === targetId).map((g) => g.user_id));
  const toGrant = Array.from(
    new Set((grants ?? []).filter((g) => g.entity_id === sourceId).map((g) => g.user_id as string))
  ).filter((userId) => !hasTarget.has(userId));
  if (toGrant.length > 0) {
    const { error } = await supabase.from("entity_access").insert(
      toGrant.map((userId) => ({
        organization_id: profile.organization_id,
        user_id: userId,
        entity_id: targetId,
      }))
    );
    if (error) return { error: stopped("member access", error) };
  }

  const { error: deleteError } = await supabase.from("entities").delete().eq("id", sourceId);
  if (deleteError) {
    return {
      error: friendlyDbError(
        deleteError,
        "Everything was moved, but the old entity could not be removed. Try the merge again to finish it."
      ),
    };
  }

  revalidatePath("/entities");
  revalidatePath("/properties");
  redirect(`/entities/${targetId}`);
}
