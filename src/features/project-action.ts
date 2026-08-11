"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProjectInput, ProjectProposalInput } from "@/features/project-schema";
import type { Project, ProjectStatus, ApprovalStatus } from "@/lib/project";

export async function getProjects({
  status = "",
  product_id = "",
  search = "",
  approvalStatus,
}: {
  status?: ProjectStatus | "";
  product_id?: string;
  search?: string;
  approvalStatus?: ApprovalStatus;
} = {}): Promise<Project[]> {
  const supabase = await createClient();

  let query = supabase.from("projects").select("*");

  const term = search.trim();
  if (term) query = query.ilike("name", `%${term}%`);
  if (status) query = query.eq("status", status);
  if (product_id) query = query.eq("product_id", product_id);
  if (approvalStatus) query = query.eq("approval_status", approvalStatus);

  const { data, error } = await query.order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}

export async function createProject(input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("projects").insert({
    name: parsed.data.name,
    item_type: parsed.data.item_type,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date,
    product_id: parsed.data.product_id,
    status: parsed.data.status,
    progress_percent: parsed.data.status === "completed" ? 100 : parsed.data.progress_percent,
    total_working_hours: parsed.data.total_working_hours,
    priority: parsed.data.priority,
    jira_link: parsed.data.jira_link,
    jiva_link: parsed.data.jiva_link,
    approval_status: "approved",
  });

  if (error) throw new Error(error.message);
  return { success: true };
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * When a work item is marked Completed: reject any pending allocation
 * proposal on it, clear any pending rebaseline change, close out ongoing
 * approved allocations (end_date = today), and delete approved allocations
 * that hadn't started yet. Idempotent — safe to run even if some rows are
 * already in their target state.
 */
async function releaseAllocationsForCompletedProject(admin: AdminClient, projectId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: allocations, error } = await admin
    .from("allocations")
    .select("id, start_date, end_date, approval_status, proposed_start_date")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  for (const allocation of allocations ?? []) {
    if (allocation.approval_status === "pending") {
      await admin.from("allocations").update({ approval_status: "rejected" }).eq("id", allocation.id);
      continue;
    }

    if (allocation.approval_status !== "approved") continue;

    const updates: Record<string, unknown> = {};

    if (allocation.proposed_start_date !== null) {
      updates.proposed_start_date = null;
      updates.proposed_end_date = null;
      updates.proposed_hours_per_week = null;
      updates.proposed_priority = null;
      updates.change_proposed_by = null;
      updates.change_requested_at = null;
    }

    if (allocation.start_date > today) {
      await admin.from("allocations").delete().eq("id", allocation.id);
      continue;
    }

    if (allocation.end_date === null || allocation.end_date > today) {
      updates.end_date = today;
    }

    if (Object.keys(updates).length > 0) {
      await admin.from("allocations").update(updates).eq("id", allocation.id);
    }
  }
}

export async function updateProject(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const becomingCompleted = parsed.data.status === "completed";

  const { error } = await admin
    .from("projects")
    .update({
      name: parsed.data.name,
      item_type: parsed.data.item_type,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      product_id: parsed.data.product_id,
      status: parsed.data.status,
      progress_percent: becomingCompleted ? 100 : parsed.data.progress_percent,
      total_working_hours: parsed.data.total_working_hours,
      priority: parsed.data.priority,
      jira_link: parsed.data.jira_link,
      jiva_link: parsed.data.jiva_link,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  if (becomingCompleted) {
    await releaseAllocationsForCompletedProject(admin, id);
  }

  return { success: true };
}

export async function deleteProject(id: string): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const admin = createAdminClient();
  const { error } = await admin.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function proposeProject(input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const parsed = ProjectProposalInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      name: parsed.data.project.name,
      item_type: parsed.data.project.item_type,
      start_date: parsed.data.project.start_date,
      end_date: parsed.data.project.end_date,
      product_id: parsed.data.project.product_id,
      status: parsed.data.project.status,
      progress_percent: parsed.data.project.progress_percent,
      total_working_hours: parsed.data.project.total_working_hours ?? 0,
      priority: parsed.data.project.priority,
      jira_link: parsed.data.project.jira_link,
      jiva_link: parsed.data.project.jiva_link,
      approval_status: "pending",
      proposed_by: profile.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    throw new Error(projectError?.message ?? "Failed to submit proposal");
  }

  const { error: allocationsError } = await admin.from("allocations").insert(
    parsed.data.allocations.map((allocation) => ({
      user_id: allocation.user_id,
      project_id: project.id,
      role_on_project: allocation.role_on_project,
      hours_per_week: allocation.hours_per_week,
      start_date: allocation.start_date,
      end_date: allocation.end_date ?? null,
      approval_status: "pending",
      proposed_by: profile.id,
    })),
  );

  if (allocationsError) {
    await admin.from("projects").delete().eq("id", project.id);
    throw new Error(allocationsError.message);
  }

  return { success: true };
}

export async function withdrawProjectProposal(id: string): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("proposed_by, approval_status")
    .eq("id", id)
    .single();

  if (!project || project.proposed_by !== profile.id || project.approval_status !== "pending") {
    throw new Error("This proposal can no longer be withdrawn");
  }

  const { error } = await admin.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { success: true };
}
