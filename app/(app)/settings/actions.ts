"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";

export async function createInvite(formData: FormData) {
  const { supabase, profile } = await requireOrg();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role") === "admin" ? "admin" : "user";
  // Entity grants only mean something for user-role invites; admins see
  // everything regardless.
  const entityIds =
    role === "user"
      ? formData.getAll("entity_ids").map(String).filter(Boolean)
      : [];
  if (!email) return;

  // RLS only allows admins to insert invites; for anyone else this is a no-op.
  await supabase.from("invites").insert({
    organization_id: profile.organization_id,
    email,
    role,
    entity_ids: entityIds,
    invited_by: profile.id,
  });
  revalidatePath("/settings");
}

export async function deleteInvite(formData: FormData) {
  const { supabase } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase.from("invites").delete().eq("id", id);
  revalidatePath("/settings");
}

// The ONE way a role changes from the app: the SECURITY DEFINER
// set_member_role function (profiles updates are column-restricted).
// It refuses non-admins, other orgs, and your own row.
export async function setMemberRole(formData: FormData) {
  const { supabase } = await requireOrg();
  const target = String(formData.get("target") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!target || !role) return;
  await supabase.rpc("set_member_role", { target, new_role: role });
  revalidatePath("/settings");
}

// Replace a user's entity grants with the checked set. entity_access
// RLS makes this admin-only; the composite FK keeps grants in-org.
export async function saveEntityAccess(formData: FormData) {
  const { supabase, profile } = await requireOrg();
  const userId = String(formData.get("user_id") ?? "");
  const entityIds = formData.getAll("entity_ids").map(String).filter(Boolean);
  if (!userId) return;

  const { data: current } = await supabase
    .from("entity_access")
    .select("id, entity_id")
    .eq("user_id", userId);
  const wanted = new Set(entityIds);
  const toRemove = (current ?? []).filter((r) => !wanted.has(r.entity_id));
  const have = new Set((current ?? []).map((r) => r.entity_id));
  const toAdd = entityIds.filter((id) => !have.has(id));

  if (toRemove.length > 0) {
    await supabase
      .from("entity_access")
      .delete()
      .in("id", toRemove.map((r) => r.id));
  }
  if (toAdd.length > 0) {
    await supabase.from("entity_access").insert(
      toAdd.map((entityId) => ({
        organization_id: profile.organization_id,
        user_id: userId,
        entity_id: entityId,
      }))
    );
  }
  revalidatePath("/settings");
}
