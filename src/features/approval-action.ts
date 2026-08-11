"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { assertWithinParallelLimit } from "@/features/allocation-action";
import { ApproveProjectProposalInput } from "@/features/project-schema";
import type { Allocation } from "@/lib/allocation";
import type { Project } from "@/lib/project";

export type PendingProjectProposal = Project & { allocations: Allocation[] };

export async function getPendingProjectProposals(): Promise<PendingProjectProposal[]> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { data: projects, error } = await admin
    .from("projects")
    .select("*")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const proposals: PendingProjectProposal[] = [];
  for (const project of (projects ?? []) as Project[]) {
    const { data: allocations } = await admin.from("allocations").select("*").eq("project_id", project.id);
    proposals.push({ ...project, allocations: (allocations ?? []) as Allocation[] });
  }
  return proposals;
}

export async function getPendingAllocationProposals(): Promise<Allocation[]> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("allocations")
    .select("*, projects!inner(approval_status)")
    .eq("approval_status", "pending")
    .eq("projects.approval_status", "approved")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

export async function getPendingAllocationChanges(): Promise<Allocation[]> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("allocations")
    .select("*")
    .not("proposed_start_date", "is", null)
    .order("change_requested_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

export async function approveProjectProposal(projectId: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ApproveProjectProposalInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: allocations, error: fetchError } = await admin
    .from("allocations")
    .select("id, user_id, start_date, end_date")
    .eq("project_id", projectId)
    .eq("approval_status", "pending");
  if (fetchError) throw new Error(fetchError.message);

  for (const allocation of allocations ?? []) {
    await assertWithinParallelLimit(admin, allocation.user_id, projectId, allocation.start_date, allocation.end_date);
  }

  const { error: projectError } = await admin
    .from("projects")
    .update({ approval_status: "approved", total_working_hours: parsed.data.total_working_hours })
    .eq("id", projectId);
  if (projectError) throw new Error(projectError.message);

  const { error: allocationsError } = await admin
    .from("allocations")
    .update({ approval_status: "approved" })
    .eq("project_id", projectId)
    .eq("approval_status", "pending");
  if (allocationsError) throw new Error(allocationsError.message);

  return { success: true };
}

export async function rejectProjectProposal(projectId: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error: projectError } = await admin
    .from("projects")
    .update({ approval_status: "rejected" })
    .eq("id", projectId);
  if (projectError) throw new Error(projectError.message);

  const { error: allocationsError } = await admin
    .from("allocations")
    .update({ approval_status: "rejected" })
    .eq("project_id", projectId)
    .eq("approval_status", "pending");
  if (allocationsError) throw new Error(allocationsError.message);

  return { success: true };
}

export async function approveAllocation(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { data: allocation, error: fetchError } = await admin
    .from("allocations")
    .select("user_id, project_id, start_date, end_date")
    .eq("id", id)
    .single();
  if (fetchError || !allocation) throw new Error(fetchError?.message ?? "Assignment not found");

  await assertWithinParallelLimit(
    admin,
    allocation.user_id,
    allocation.project_id,
    allocation.start_date,
    allocation.end_date,
    id,
  );

  const { error } = await admin.from("allocations").update({ approval_status: "approved" }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function rejectAllocation(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("allocations").update({ approval_status: "rejected" }).eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function approveAllocationChange(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();

  const { data: allocation, error: fetchError } = await admin
    .from("allocations")
    .select("user_id, project_id, proposed_start_date, proposed_end_date, proposed_hours_per_week, proposed_priority")
    .eq("id", id)
    .single();
  if (fetchError || !allocation || allocation.proposed_start_date === null) {
    throw new Error("This assignment has no pending change");
  }

  await assertWithinParallelLimit(
    admin,
    allocation.user_id,
    allocation.project_id,
    allocation.proposed_start_date,
    allocation.proposed_end_date,
    id,
  );

  const { error } = await admin
    .from("allocations")
    .update({
      start_date: allocation.proposed_start_date,
      end_date: allocation.proposed_end_date,
      hours_per_week: allocation.proposed_hours_per_week,
      priority: allocation.proposed_priority,
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_hours_per_week: null,
      proposed_priority: null,
      change_proposed_by: null,
      change_requested_at: null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function rejectAllocationChange(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin
    .from("allocations")
    .update({
      proposed_start_date: null,
      proposed_end_date: null,
      proposed_hours_per_week: null,
      proposed_priority: null,
      change_proposed_by: null,
      change_requested_at: null,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}
