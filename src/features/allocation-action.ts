"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { AllocationInput } from "@/features/allocation-schema";
import type { Allocation } from "@/lib/allocation";

export async function getAllocationsForUser(userId: string): Promise<Allocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("*")
    .eq("user_id", userId)
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

export async function createAllocation(input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["qa_lead", "project_manager"]);

  const parsed = AllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("approval_status")
    .eq("id", parsed.data.project_id)
    .single();

  if (!project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }

  const isLead = profile.role === "qa_lead";

  const { error } = await admin.from("allocations").insert({
    user_id: parsed.data.user_id,
    project_id: parsed.data.project_id,
    role_on_project: parsed.data.role_on_project,
    hours_per_week: parsed.data.hours_per_week,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date ?? null,
    approval_status: isLead ? "approved" : "pending",
    proposed_by: isLead ? null : profile.id,
  });

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function updateAllocation(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = AllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("allocations")
    .update({
      user_id: parsed.data.user_id,
      project_id: parsed.data.project_id,
      role_on_project: parsed.data.role_on_project,
      hours_per_week: parsed.data.hours_per_week,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteAllocation(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("allocations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function withdrawAllocationProposal(id: string): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const admin = createAdminClient();
  const { data: allocation } = await admin
    .from("allocations")
    .select("proposed_by, approval_status")
    .eq("id", id)
    .single();

  if (!allocation || allocation.proposed_by !== profile.id || allocation.approval_status !== "pending") {
    throw new Error("This proposal can no longer be withdrawn");
  }

  const { error } = await admin.from("allocations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
