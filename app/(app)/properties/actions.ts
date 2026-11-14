"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { friendlyDbError } from "@/lib/dbErrors";

// What the "+ New property" form shows after a try: why it did not
// save, or the name of the property that was created.
export type NewPropertyState = {
  error: string | null;
  created: string | null;
  // What was typed, handed back when the save fails so the form does
  // not come back empty (a form is cleared after every submit).
  values?: {
    name: string;
    county: string;
    state: string;
    fsa_numbers: string;
    entity_id: string;
  };
};

export async function createProperty(
  _prev: NewPropertyState,
  formData: FormData
): Promise<NewPropertyState> {
  const { supabase, profile } = await requireOrg();
  const name = String(formData.get("name") ?? "").trim();
  const values = {
    name,
    county: String(formData.get("county") ?? ""),
    state: String(formData.get("state") ?? ""),
    fsa_numbers: String(formData.get("fsa_numbers") ?? ""),
    entity_id: String(formData.get("entity_id") ?? ""),
  };
  if (!name) return { error: "Give the property a name.", created: null, values };

  const fsaNumbers = String(formData.get("fsa_numbers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const { error } = await supabase.from("properties").insert({
    organization_id: profile.organization_id,
    name,
    county: String(formData.get("county") ?? "").trim() || null,
    state: String(formData.get("state") ?? "").trim() || null,
    entity_id: String(formData.get("entity_id") ?? "").trim() || null,
    fsa_numbers: fsaNumbers.length > 0 ? fsaNumbers : null,
  });
  if (error) {
    // Refused (someone who is not an admin, for one) or the connection
    // dropped: say so instead of leaving the form looking as if it worked.
    return {
      error: friendlyDbError(error, "The property could not be created. Please try again."),
      created: null,
      values,
    };
  }
  revalidatePath("/properties");
  return { error: null, created: name };
}
