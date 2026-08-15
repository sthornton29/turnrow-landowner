"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";

export async function createTenant(formData: FormData) {
  const { supabase, profile } = await requireOrg();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { data } = await supabase
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
  revalidatePath("/tenants");
  if (data) redirect(`/tenants/${data.id}`);
}

export async function updateTenant(formData: FormData) {
  const { supabase } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabase
    .from("tenants")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      contact_person: String(formData.get("contact_person") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      mailing_address: String(formData.get("mailing_address") ?? "").trim() || null,
      insurance_on_file: formData.get("insurance_on_file") === "on",
      insurance_expires: String(formData.get("insurance_expires") ?? "") || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .eq("id", id);
  revalidatePath(`/tenants/${id}`);
  revalidatePath("/tenants");
}

export async function deleteTenant(formData: FormData) {
  const { supabase } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Fails (restrict FK) if the tenant still holds leases; surfaced in UI copy.
  await supabase.from("tenants").delete().eq("id", id);
  revalidatePath("/tenants");
  redirect("/tenants");
}
