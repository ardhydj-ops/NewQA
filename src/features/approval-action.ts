"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
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

export async function approveProjectProposal(projectId: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error: projectError } = await admin
    .from("projects")
    .update({ approval_status: "approved" })
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
