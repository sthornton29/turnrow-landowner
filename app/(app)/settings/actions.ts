"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { friendlyDbError } from "@/lib/dbErrors";

// What each Settings form gets back: one sentence, good or bad. Before
// this every action swallowed its result, so a refused change looked
// exactly like a saved one.
export type SettingsFormState = { error: string | null; message: string | null };

const ok = (message: string): SettingsFormState => ({ error: null, message });
const fail = (error: string): SettingsFormState => ({ error, message: null });

const ADMINS_ONLY = "Only an admin can change members and access.";

// Invite someone, or change an invite that has not been used yet.
// NOTE: no email is sent. The admin gives the person the sign-up link;
// when they sign up with this exact address they are connected.
export async function createInvite(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { supabase, profile, isAdmin } = await requireOrg();
  if (!isAdmin) return fail(ADMINS_ONLY);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role") === "admin" ? "admin" : "user";
  // Entity grants only mean something for user-role invites; admins see
  // everything regardless.
  const entityIds =
    role === "user"
      ? [...new Set(formData.getAll("entity_ids").map(String).filter(Boolean))]
      : [];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail("Enter the person's full email address.");
  }
  if (role === "user" && entityIds.length === 0) {
    return fail(
      "Tick at least one entity this person should see. A user with no entities signs in to an empty account."
    );
  }

  // Exact match on the lowercased address (sign-in stores emails in
  // lowercase, and invites are saved lowercased here). Not a pattern
  // match: "_" is common in addresses and is a wildcard in one.
  const { data: member, error: memberError } = await supabase
    .from("profiles")
    .select("id")
    .eq("organization_id", profile.organization_id)
    .eq("email", email)
    .maybeSingle();
  if (memberError) return fail(friendlyDbError(memberError, "Could not check the member list. Try again."));
  if (member) {
    return fail(`${email} is already a member. Change their role or access in the list above.`);
  }

  // One row per email (unique). There is no update on invites, so an
  // earlier row for this address (pending, or used by someone since
  // removed) is replaced.
  const { data: existing, error: existingError } = await supabase
    .from("invites")
    .select("id, accepted_at")
    .eq("email", email)
    .maybeSingle();
  if (existingError) return fail(friendlyDbError(existingError, "Could not check existing invites. Try again."));
  if (existing) {
    const { error } = await supabase.from("invites").delete().eq("id", existing.id);
    if (error) return fail(friendlyDbError(error, "Could not replace the earlier invite. Try again."));
  }

  const { error } = await supabase.from("invites").insert({
    organization_id: profile.organization_id,
    email,
    role,
    entity_ids: entityIds,
    invited_by: profile.id,
  });
  if (error) return fail(friendlyDbError(error, "The invite was not saved. Try again."));

  revalidatePath("/settings");
  return ok(
    `${existing && !existing.accepted_at ? "Invite updated" : "Invite saved"} for ${email}. No email is sent from here: send them the sign-up link below, and have them sign up with this exact address.`
  );
}

export async function deleteInvite(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { supabase, isAdmin } = await requireOrg();
  if (!isAdmin) return fail(ADMINS_ONLY);
  const id = String(formData.get("id") ?? "");
  if (!id) return fail("That invite was not found.");
  const { error } = await supabase.from("invites").delete().eq("id", id);
  if (error) return fail(friendlyDbError(error, "The invite was not removed. Try again."));
  revalidatePath("/settings");
  return ok("Invite removed.");
}

// One Save per member: their role and, for a user, the entities they
// can see. The role goes through the SECURITY DEFINER set_member_role
// function (profiles updates are column-restricted); it refuses
// non-admins, other orgs, and your own row. entity_access RLS makes the
// grants admin-only and the composite key keeps them in-org.
export async function saveMember(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { supabase, profile, isAdmin } = await requireOrg();
  if (!isAdmin) return fail(ADMINS_ONLY);

  const userId = String(formData.get("user_id") ?? "");
  const role = formData.get("role") === "admin" ? "admin" : "user";
  const entityIds = [...new Set(formData.getAll("entity_ids").map(String).filter(Boolean))];
  if (!userId) return fail("That member was not found.");
  if (userId === profile.id) return fail("You cannot change your own role. Ask another admin.");

  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, role, full_name, email")
    .eq("id", userId)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();
  if (targetError) return fail(friendlyDbError(targetError, "Could not load that member. Try again."));
  if (!target) return fail("That member was not found.");
  const name = target.full_name || target.email;

  if (target.role !== role) {
    const { error } = await supabase.rpc("set_member_role", { target: userId, new_role: role });
    if (error) return fail(friendlyDbError(error, "The role was not changed. Try again."));
  }

  // Grants are kept even while someone is an admin (they are ignored
  // for admins), so the form only touches them for a user.
  if (role === "user") {
    const { data: current, error: currentError } = await supabase
      .from("entity_access")
      .select("id, entity_id")
      .eq("user_id", userId);
    if (currentError) return fail(friendlyDbError(currentError, "Could not load their access. Try again."));
    const wanted = new Set(entityIds);
    const toRemove = (current ?? []).filter((r) => !wanted.has(r.entity_id));
    const have = new Set((current ?? []).map((r) => r.entity_id));
    const toAdd = entityIds.filter((id) => !have.has(id));

    // Add first, then remove: if the second step fails the person keeps
    // more access than intended for a moment, never less than they need.
    if (toAdd.length > 0) {
      const { error } = await supabase.from("entity_access").insert(
        toAdd.map((entityId) => ({
          organization_id: profile.organization_id,
          user_id: userId,
          entity_id: entityId,
        }))
      );
      if (error) return fail(friendlyDbError(error, "Their access was not saved. Try again."));
    }
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from("entity_access")
        .delete()
        .in("id", toRemove.map((r) => r.id));
      if (error) {
        revalidatePath("/settings");
        return fail(
          friendlyDbError(error, "New access was added, but the entities you unticked were not removed. Save again.")
        );
      }
    }
  }

  revalidatePath("/settings");
  if (role === "admin") return ok(`Saved. ${name} is an admin and sees everything.`);
  if (entityIds.length === 0) {
    return ok(`Saved, but ${name} has no entities ticked and will see an empty account.`);
  }
  return ok(`Saved. ${name} can see ${entityIds.length === 1 ? "1 entity" : `${entityIds.length} entities`}.`);
}

// Take a person off the account (migration 0053). Their sign-in stays;
// they simply are not connected to this organization any more.
export async function removeMember(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { supabase, profile, isAdmin } = await requireOrg();
  if (!isAdmin) return fail(ADMINS_ONLY);
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return fail("That member was not found.");
  if (userId === profile.id) return fail("You cannot remove yourself. Ask another admin.");

  const { error } = await supabase.rpc("remove_member", { target: userId });
  if (error) {
    // PGRST202 / 42883: the function is not in the database yet.
    if (error.code === "PGRST202" || error.code === "42883") {
      return fail(
        "Removing a member needs a database update that has not been applied yet. Until then, change them to User and untick every entity."
      );
    }
    return fail(friendlyDbError(error, "The member was not removed. Try again."));
  }
  revalidatePath("/settings");
  return ok("Removed. They can no longer see anything on this account.");
}

// Your own display name (the one thing a member may change on their
// own profile).
export async function updateOwnName(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { supabase, profile } = await requireOrg();
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return fail("Enter your name.");
  if (fullName.length > 120) return fail("That name is too long.");
  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", profile.id);
  if (error) return fail(friendlyDbError(error, "Your name was not saved. Try again."));
  revalidatePath("/", "layout");
  return ok("Name saved.");
}
