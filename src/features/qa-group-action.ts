"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { QaGroupInput } from "@/features/qa-group-schema";
import type { QaGroupRow } from "@/lib/qa-group";
import { QA_LEAD_ROLES } from "@/lib/profile";

export async function getQaGroups(): Promise<QaGroupRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("qa_groups").select("id, name").order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as QaGroupRow[];
}

function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("A QA Group with that name already exists");
  return new Error(error.message);
}

export async function createQaGroup(input: unknown): Promise<{ success: true }> {
  await requireRole(QA_LEAD_ROLES);

  const parsed = QaGroupInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("qa_groups").insert({ name: parsed.data.name });
  if (error) throw friendlyError(error);
  return { success: true };
}

export async function updateQaGroup(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(QA_LEAD_ROLES);

  const parsed = QaGroupInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("qa_groups").update({ name: parsed.data.name }).eq("id", id);
  if (error) throw friendlyError(error);
  return { success: true };
}

export async function deleteQaGroup(id: string): Promise<{ success: true }> {
  await requireRole(QA_LEAD_ROLES);

  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("qa_group_id", id);
  if (countError) throw new Error(countError.message);
  if (count && count > 0) {
    throw new Error(`Can't delete: ${count} QA(s) are still in this group`);
  }

  const { error } = await admin.from("qa_groups").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
