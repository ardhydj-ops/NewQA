"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProjectChangeInput, ProjectInput, ProjectProposalInput } from "@/features/project-schema";
import { QA_LEAD_ROLES } from "@/lib/profile";
import type { Project, ProjectStatus, ApprovalStatus, ItemType, Priority } from "@/lib/project";

type AdminClient = ReturnType<typeof createAdminClient>;

async function setProjectProducts(admin: AdminClient, projectId: string, productIds: string[]): Promise<void> {
  const { error: deleteError } = await admin.from("project_products").delete().eq("project_id", projectId);
  if (deleteError) throw new Error(deleteError.message);

  const { error: insertError } = await admin
    .from("project_products")
    .insert(productIds.map((productId) => ({ project_id: projectId, product_id: productId })));
  if (insertError) throw new Error(insertError.message);
}

export async function getProjects({
  status = "",
  product_id = "",
  search = "",
  item_type = "",
  priority = "",
  approvalStatus,
}: {
  status?: ProjectStatus | "";
  product_id?: string;
  search?: string;
  item_type?: ItemType | "";
  priority?: Priority | "";
  approvalStatus?: ApprovalStatus;
} = {}): Promise<Project[]> {
  const supabase = await createClient();

  let query = supabase.from("projects").select("*, project_products(product_id)");

  const term = search.trim();
  if (term) query = query.ilike("name", `%${term}%`);
  if (status) query = query.eq("status", status);
  if (item_type) query = query.eq("item_type", item_type);
  if (priority) query = query.eq("priority", priority);
  if (approvalStatus) query = query.eq("approval_status", approvalStatus);

  if (product_id) {
    const { data: matches, error: matchError } = await supabase
      .from("project_products")
      .select("project_id")
      .eq("product_id", product_id);
    if (matchError) throw new Error(matchError.message);
    const projectIds = (matches ?? []).map((m) => m.project_id);
    if (projectIds.length === 0) return [];
    query = query.in("id", projectIds);
  }

  const { data, error } = await query.order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const { project_products, ...project } = row as Project & { project_products: { product_id: string }[] };
    return { ...project, product_ids: project_products.map((pp) => pp.product_id) };
  });
}

export async function createProject(input: unknown): Promise<{ success: true }> {
  await requireRole(QA_LEAD_ROLES);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { data: project, error } = await admin
    .from("projects")
    .insert({
      name: parsed.data.name,
      item_type: parsed.data.item_type,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      status: parsed.data.status,
      progress_percent: parsed.data.status === "completed" ? 100 : parsed.data.progress_percent,
      total_working_days: parsed.data.total_working_days,
      priority: parsed.data.priority,
      jira_link: parsed.data.jira_link,
      jiva_link: parsed.data.jiva_link,
      approval_status: "approved",
    })
    .select("id")
    .single();

  if (error || !project) throw new Error(error?.message ?? "Failed to create item");

  await setProjectProducts(admin, project.id, parsed.data.product_ids);
  return { success: true };
}

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
      updates.proposed_days_per_week = null;
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
  await requireRole(QA_LEAD_ROLES);

  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const becomingCompleted = parsed.data.status === "completed";

  const { data: currentProducts, error: currentError } = await admin
    .from("project_products")
    .select("product_id")
    .eq("project_id", id);
  if (currentError) throw new Error(currentError.message);

  const removedProductIds = (currentProducts ?? [])
    .map((p) => p.product_id)
    .filter((productId) => !parsed.data.product_ids.includes(productId));

  if (removedProductIds.length > 0) {
    const { data: stillAssigned, error: assignedError } = await admin
      .from("allocations")
      .select("product_id")
      .eq("project_id", id)
      .eq("approval_status", "approved")
      .in("product_id", removedProductIds);
    if (assignedError) throw new Error(assignedError.message);
    if (stillAssigned && stillAssigned.length > 0) {
      const { data: product } = await admin
        .from("products")
        .select("name")
        .eq("id", stillAssigned[0].product_id)
        .single();
      throw new Error(
        `Can't remove ${product?.name ?? "this product"}: ${stillAssigned.length} assignment(s) still reference it.`,
      );
    }
  }

  const { error } = await admin
    .from("projects")
    .update({
      name: parsed.data.name,
      item_type: parsed.data.item_type,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      status: parsed.data.status,
      progress_percent: becomingCompleted ? 100 : parsed.data.progress_percent,
      total_working_days: parsed.data.total_working_days,
      priority: parsed.data.priority,
      jira_link: parsed.data.jira_link,
      jiva_link: parsed.data.jiva_link,
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  await setProjectProducts(admin, id, parsed.data.product_ids);

  if (becomingCompleted) {
    await releaseAllocationsForCompletedProject(admin, id);
  }

  return { success: true };
}

export async function deleteProject(id: string): Promise<{ success: true }> {
  await requireRole(QA_LEAD_ROLES);

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
      status: parsed.data.project.status,
      progress_percent: parsed.data.project.progress_percent,
      total_working_days: parsed.data.project.total_working_days ?? 0,
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

  const { error: productsError } = await admin
    .from("project_products")
    .insert(parsed.data.project.product_ids.map((productId) => ({ project_id: project.id, product_id: productId })));
  if (productsError) {
    await admin.from("projects").delete().eq("id", project.id);
    throw new Error(productsError.message);
  }

  const { error: allocationsError } = await admin.from("allocations").insert(
    parsed.data.allocations.map((allocation) => ({
      user_id: allocation.user_id,
      project_id: project.id,
      product_id: allocation.product_id,
      role_on_project: allocation.role_on_project,
      days_per_week: allocation.days_per_week,
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

/**
 * A Project Manager's request to change Start Date / End Date / Total
 * Working Days / Priority on an already-approved project. Stages into
 * `proposed_*` — never touches the live columns directly. Blocked while
 * another change is already pending on the same row. A QA Lead's own edit
 * instead goes through `updateProject` directly (immediate, no staging).
 */
export async function proposeProjectChange(id: string, input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const parsed = ProjectChangeInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("approval_status, proposed_start_date")
    .eq("id", id)
    .single();

  if (!project || project.approval_status !== "approved") {
    throw new Error("Only an approved item can be rebaselined");
  }
  if (project.proposed_start_date !== null) {
    throw new Error("This item already has a pending change awaiting approval");
  }

  const { error } = await admin
    .from("projects")
    .update({
      proposed_start_date: parsed.data.start_date,
      proposed_end_date: parsed.data.end_date,
      proposed_total_working_days: parsed.data.total_working_days,
      proposed_priority: parsed.data.priority,
      change_proposed_by: profile.id,
      change_requested_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}
