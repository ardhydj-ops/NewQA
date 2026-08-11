"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { getSettings } from "@/features/settings-action";
import {
  AllocationInput,
  AllocationChangeInput,
  BulkAllocationInput,
} from "@/features/allocation-schema";
import { monthlyDaysForUser, overlappingProjectCount, weeksBetween } from "@/lib/load";
import type { Allocation } from "@/lib/allocation";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Hard-blocks an allocation/change/approval that would push a QA over
 * `app_settings.max_parallel_projects` distinct concurrent projects.
 * `excludeAllocationId` excludes the row being updated (from its own old
 * state) when re-checking an existing allocation; the candidate's own
 * `projectId` is always excluded from the count (assigning the same
 * project twice isn't "2 parallel projects").
 */
export async function assertWithinParallelLimit(
  admin: AdminClient,
  userId: string,
  projectId: string,
  startDate: string,
  endDate: string | null,
  excludeAllocationId?: string,
): Promise<void> {
  const settings = await getSettings();

  let query = admin
    .from("allocations")
    .select("id, project_id, start_date, end_date")
    .eq("user_id", userId)
    .eq("approval_status", "approved");
  if (excludeAllocationId) query = query.neq("id", excludeAllocationId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const existing = (data ?? []) as { project_id: string; start_date: string; end_date: string | null }[];
  const count = overlappingProjectCount(
    existing.map((a) => ({
      user_id: userId,
      project_id: a.project_id,
      start_date: a.start_date,
      end_date: a.end_date,
    })),
    userId,
    { start_date: startDate, end_date: endDate },
    projectId,
  );

  if (count + 1 > settings.max_parallel_projects) {
    throw new Error(
      `This would exceed the max of ${settings.max_parallel_projects} parallel projects for this QA.`,
    );
  }
}

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

  if (isLead) {
    await assertWithinParallelLimit(
      admin,
      parsed.data.user_id,
      parsed.data.project_id,
      parsed.data.start_date,
      parsed.data.end_date ?? null,
    );
  }

  const { error } = await admin.from("allocations").insert({
    user_id: parsed.data.user_id,
    project_id: parsed.data.project_id,
    role_on_project: parsed.data.role_on_project,
    days_per_week: parsed.data.days_per_week,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date ?? null,
    priority: parsed.data.priority,
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

  await assertWithinParallelLimit(
    admin,
    parsed.data.user_id,
    parsed.data.project_id,
    parsed.data.start_date,
    parsed.data.end_date ?? null,
    id,
  );

  const { error } = await admin
    .from("allocations")
    .update({
      user_id: parsed.data.user_id,
      project_id: parsed.data.project_id,
      role_on_project: parsed.data.role_on_project,
      days_per_week: parsed.data.days_per_week,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date ?? null,
      priority: parsed.data.priority,
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

/**
 * A Project Manager's request to change dates/hours/priority on an
 * already-approved allocation. Stages into `proposed_*` — never touches
 * the live columns directly. Blocked while another change is already
 * pending on the same row. A QA Lead's own rebaseline instead calls
 * `updateAllocation` directly (immediate, no staging) — see
 * `RebaselineDialog` in Task 11.
 */
export async function proposeAllocationChange(id: string, input: unknown): Promise<{ success: true }> {
  const profile = await requireRole(["project_manager"]);

  const parsed = AllocationChangeInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: allocation } = await admin
    .from("allocations")
    .select("approval_status, proposed_start_date")
    .eq("id", id)
    .single();

  if (!allocation || allocation.approval_status !== "approved") {
    throw new Error("Only an approved assignment can be rebaselined");
  }
  if (allocation.proposed_start_date !== null) {
    throw new Error("This assignment already has a pending change awaiting approval");
  }

  const { error } = await admin
    .from("allocations")
    .update({
      proposed_start_date: parsed.data.start_date,
      proposed_end_date: parsed.data.end_date ?? null,
      proposed_days_per_week: parsed.data.days_per_week,
      proposed_priority: parsed.data.priority,
      change_proposed_by: profile.id,
      change_requested_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  return { success: true };
}

/**
 * Assigns one project/activity to several QAs at once, splitting its
 * `total_working_days` evenly (per QA, per week, over the item's own
 * date range, rounded to the nearest half-day). Each QA gets an
 * independent allocation row. QA-Lead batches go live immediately
 * (per-QA, subject to the parallel-limit check); PM batches are
 * standalone `pending` proposals, same rule as the single-QA flow.
 * Partial success is expected and reported — one QA failing the limit
 * check doesn't block the others.
 */
export async function createBulkAllocations(
  input: unknown,
): Promise<{ created: string[]; failed: { userId: string; reason: string }[] }> {
  const profile = await requireRole(["qa_lead", "project_manager"]);

  const parsed = BulkAllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("approval_status, start_date, end_date, total_working_days")
    .eq("id", parsed.data.project_id)
    .single();

  if (projectError || !project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }
  if (!project.end_date) {
    throw new Error("This item has no end date and can't be evenly split");
  }

  const { data: existingAllocations, error: existingError } = await admin
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  const committed = (existingAllocations ?? []).reduce(
    (sum, a) => sum + a.days_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );
  const remainingDays = Math.max(0, project.total_working_days - committed);

  const weeks = weeksBetween(project.start_date, project.end_date);
  const daysPerWeek = Math.round((remainingDays / parsed.data.user_ids.length / weeks) * 2) / 2;
  const isLead = profile.role === "qa_lead";

  const created: string[] = [];
  const failed: { userId: string; reason: string }[] = [];

  for (const userId of parsed.data.user_ids) {
    if (isLead) {
      try {
        await assertWithinParallelLimit(admin, userId, parsed.data.project_id, project.start_date, project.end_date);
      } catch (limitError) {
        failed.push({ userId, reason: (limitError as Error).message });
        continue;
      }
    }

    const { error } = await admin.from("allocations").insert({
      user_id: userId,
      project_id: parsed.data.project_id,
      role_on_project: parsed.data.role_on_project,
      days_per_week: daysPerWeek,
      start_date: project.start_date,
      end_date: project.end_date,
      priority: "medium",
      approval_status: isLead ? "approved" : "pending",
      proposed_by: isLead ? null : profile.id,
    });

    if (error) {
      failed.push({ userId, reason: error.message });
    } else {
      created.push(userId);
    }
  }

  return { created, failed };
}

/**
 * `total_working_days` minus what's already committed to this project by
 * its own *approved* allocations (each converted to a total-days figure via
 * `days_per_week * weeksBetween(start, end ?? project.end_date)` — every
 * project has a required `end_date` since v2, so an open-ended allocation
 * always has a concrete fallback bound). Floored at 0.
 */
export async function getRemainingProjectDays(projectId: string): Promise<number> {
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("total_working_days, end_date")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Item not found");

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", projectId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const committed = (allocations ?? []).reduce(
    (sum, a) => sum + a.days_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );

  return Math.max(0, project.total_working_days - committed);
}

/**
 * A QA's weekly capacity minus their *approved* allocations' day-prorated
 * load within [startDate, endDate], averaged back over the weeks in that
 * range. Scoping to the candidate assignment's own date range (rather than
 * some unrelated fixed week) is what makes this accurate for multi-week
 * items. Floored at 0.
 */
export async function getRemainingUserCapacity(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("capacity_days")
    .eq("id", userId)
    .single();
  if (profileError || !profile) throw new Error(profileError?.message ?? "Resource not found");

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("user_id, project_id, days_per_week, start_date, end_date")
    .eq("user_id", userId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const allocatedInRange = monthlyDaysForUser(allocations ?? [], userId, { start: startDate, end: endDate });
  const weeks = weeksBetween(startDate, endDate);

  return Math.max(0, profile.capacity_days - allocatedInRange / weeks);
}

export async function getAllocationsForProject(projectId: string): Promise<Allocation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Allocation[];
}

export async function getApprovedAllocationCountsByProject(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("project_id")
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
  }
  return counts;
}
