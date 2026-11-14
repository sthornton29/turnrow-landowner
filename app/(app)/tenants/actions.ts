"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { friendlyDbError } from "@/lib/dbErrors";

// What each action hands back to the form that called it (the client
// forms in TenantForms.tsx): a plain sentence to show beside the button
// when it did not save, so nothing fails silently and the form keeps
// what was typed.
export type TenantActionResult = { ok: true; id?: string } | { ok: false; error: string };

export async function createTenant(formData: FormData): Promise<TenantActionResult> {
  const { supabase, profile } = await requireOrg();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Enter the tenant's name." };
  const { data, error } = await supabase
    .from("tenants")
    .insert({
      organization_id: profile.organization_id,
      name,
      contact_person: String(formData.get("contact_person") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: friendlyDbError(error, "Could not create the tenant. Nothing was saved; try again."),
    };
  }
  revalidatePath("/tenants");
  return { ok: true, id: data.id };
}

export async function updateTenant(formData: FormData): Promise<TenantActionResult> {
  const { supabase } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "That tenant was not found. Reload the page and try again." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Enter the tenant's name." };
  const { data, error } = await supabase
    .from("tenants")
    .update({
      name,
      contact_person: String(formData.get("contact_person") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      mailing_address: String(formData.get("mailing_address") ?? "").trim() || null,
      insurance_on_file: formData.get("insurance_on_file") === "on",
      insurance_expires: String(formData.get("insurance_expires") ?? "") || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .eq("id", id)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: friendlyDbError(error, "Could not save the tenant. Your changes are still here; try again."),
    };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "That tenant was not found. It may have been deleted, or you may not have access to it.",
    };
  }
  revalidatePath(`/tenants/${id}`);
  revalidatePath("/tenants");
  return { ok: true, id };
}

export async function deleteTenant(formData: FormData): Promise<TenantActionResult> {
  const { supabase } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "That tenant was not found. Reload the page and try again." };
  // The database refuses the delete while the tenant still holds a lease
  // (leases.tenant_id is ON DELETE RESTRICT, migration 0003).
  const { data, error } = await supabase.from("tenants").delete().eq("id", id).select("id");
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23503"
          ? "This tenant still has leases, so it was not deleted. Delete those leases, or move them to another tenant, first."
          : error.code === "23502"
            ? // Before migration 0053 the buyer link on a timber sale could
              // not be cleared, which blocked the delete.
              "This tenant is the buyer on a timber sale, so it was not deleted. Remove the tenant from that sale first."
            : friendlyDbError(error, "Could not delete the tenant. Nothing was removed."),
    };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "That tenant was not deleted. It may already be gone, or you may not have access to it.",
    };
  }
  revalidatePath("/tenants");
  return { ok: true };
}
