"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProjectInput, ProjectProposalInput } from "@/features/project-schema";
import type { Product, Project, ProjectStatus, ApprovalStatus } from "@/lib/project";

export async function getProjects({
  status = "",
  product = "",
  search = "",
  approvalStatus,
}: {
  status?: ProjectStatus | "";
  product?: Product | "";
  search?: string;
  approvalStatus?: ApprovalStatus;
} = {}): Promise<Project[]> {
  const supabase = await createClient();

  let query = supabase.from("projects").select("*");

  const term = search.trim();
  if (term) query = query.ilike("name", `%${term}%`);
  if (status) query = query.eq("status", status);
  if (product) query = query.eq("product", product);
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
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date ?? null,
    product: parsed.data.product,
    status: parsed.data.status,
    progress_percent: parsed.data.progress_percent,
    approval_status: "approved",
  });

  if (error) throw new Error(error.message);
  return { success: true };
}

export async function updateProject(id: string, input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({
      name: parsed.data.name,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
      product: parsed.data.product,
      status: parsed.data.status,
      progress_percent: parsed.data.progress_percent,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
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
      start_date: parsed.data.project.start_date,
      end_date: parsed.data.project.end_date ?? null,
      product: parsed.data.project.product,
      status: parsed.data.project.status,
      progress_percent: parsed.data.project.progress_percent,
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
