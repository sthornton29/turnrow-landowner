"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";

export async function createInvite(formData: FormData) {
  const { supabase, profile } = await requireOrg();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role") === "owner" ? "owner" : "member";
  if (!email) return;

  // RLS only allows owners to insert invites; for anyone else this is a no-op.
  await supabase.from("invites").insert({
    organization_id: profile.organization_id,
    email,
    role,
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
