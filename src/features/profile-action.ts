"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProfileInput, ProfileUpdateInput } from "@/features/profile-schema";
import { QA_LEAD_ROLES, type Profile, type ProfileRole } from "@/lib/profile";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Only a Head of QA can CRUD another Head of QA account. Self-management is
 * always allowed (a Head of QA managing their own row doesn't need this
 * check — they're already covered by `actor.role === "head_of_qa"`).
 * `newRole` additionally blocks promoting some other account *into*
 * head_of_qa when the actor isn't one themselves.
 */
async function assertCanManageTarget(
  admin: AdminClient,
  actor: Profile,
  targetId: string,
  newRole?: ProfileRole,
): Promise<void> {
  if (actor.id === targetId || actor.role === "head_of_qa") return;

  const { data: target, error } = await admin.from("profiles").select("role").eq("id", targetId).single();
  if (error || !target) throw new Error(error?.message ?? "Profile not found");

  if (target.role === "head_of_qa" || newRole === "head_of_qa") {
    throw new Error("Only a Head of QA can manage another Head of QA account");
  }
}

function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return password;
}

export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("*").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function getAssignableProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", ["qa_lead", "qa_member"])
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function getQaLeadCandidates(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", QA_LEAD_ROLES)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function createProfile(
  input: unknown,
): Promise<{ profile: Profile; tempPassword: string }> {
  const actor = await requireRole(QA_LEAD_ROLES);

  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (parsed.data.role === "head_of_qa" && actor.role !== "head_of_qa") {
    throw new Error("Only a Head of QA can create another Head of QA account");
  }

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    throw new Error(authError?.message ?? "Failed to create a login for this user");
  }

  const { data: profile, error: insertError } = await admin
    .from("profiles")
    .insert({
      id: authUser.user.id,
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      qa_group_id: parsed.data.qa_group_id ?? null,
      capacity_days: parsed.data.capacity_days,
    })
    .select("*")
    .single();

  if (insertError || !profile) {
    await admin.auth.admin.deleteUser(authUser.user.id);
    throw new Error(insertError?.message ?? "Failed to create profile");
  }

  return { profile: profile as Profile, tempPassword };
}

export async function updateProfile(id: string, input: unknown): Promise<{ success: true }> {
  const actor = await requireRole(QA_LEAD_ROLES);

  const parsed = ProfileUpdateInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  await assertCanManageTarget(admin, actor, id, parsed.data.role);

  const { error } = await admin
    .from("profiles")
    .update({
      name: parsed.data.name,
      role: parsed.data.role,
      qa_group_id: parsed.data.qa_group_id ?? null,
      capacity_days: parsed.data.capacity_days,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function setProfileActive(id: string, isActive: boolean): Promise<{ success: true }> {
  const actor = await requireRole(QA_LEAD_ROLES);

  const admin = createAdminClient();
  await assertCanManageTarget(admin, actor, id);

  const { error } = await admin.from("profiles").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function resetPassword(id: string): Promise<{ tempPassword: string }> {
  const actor = await requireRole(QA_LEAD_ROLES);

  const admin = createAdminClient();
  await assertCanManageTarget(admin, actor, id);

  const tempPassword = generateTempPassword();

  const { error } = await admin.auth.admin.updateUserById(id, { password: tempPassword });
  if (error) throw new Error(error.message);

  return { tempPassword };
}
