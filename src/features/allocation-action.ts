"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { getSettings } from "@/features/settings-action";
import {
  AllocationInput,
  AllocationChangeInput,
  BulkAllocationInput,
  ScheduleAllocationInput,
} from "@/features/allocation-schema";
import { isoWeekRange, monthlyDaysForUser, overlappingProjectCount, weeksBetween } from "@/lib/load";
import type { Allocation } from "@/lib/allocation";
import type { Priority } from "@/lib/project";

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

type ScheduleResult = { weeksCreated: number; placedDays: number; unplacedDays: number };

/**
 * Places `totalDays` of work for `userId` on `projectId`, one allocation
 * row per calendar week, starting from the Monday..Sunday week containing
 * `startDateISO`. Each week's row is capped at that week's actual open
 * capacity (weekly capacity minus the user's other approved allocations
 * overlapping that week, floored to a half-day so the cap never exceeds
 * real availability) — never blocks, just spills whatever doesn't fit into
 * the following week. Stops once `totalDays` is placed or the walk reaches
 * `projectEndDateISO`, whichever comes first (every project has a required
 * `end_date`, so this loop is always bounded).
 */
async function scheduleWeeklyAllocations(params: {
  admin: AdminClient;
  userId: string;
  projectId: string;
  roleOnProject: string;
  priority: Priority;
  totalDays: number;
  startDateISO: string;
  projectEndDateISO: string;
  isLead: boolean;
  proposedBy: string | null;
}): Promise<ScheduleResult> {
  const {
    admin,
    userId,
    projectId,
    roleOnProject,
    priority,
    totalDays,
    startDateISO,
    projectEndDateISO,
    isLead,
    proposedBy,
  } = params;

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("capacity_days")
    .eq("id", userId)
    .single();
  if (profileError || !profile) throw new Error(profileError?.message ?? "Resource not found");

  // Snapshot taken once, before the loop: every row this loop creates is
  // scoped to its own distinct week, so none of them overlap any other
  // week this same run schedules — the snapshot staying fixed is correct,
  // not a staleness bug.
  const { data: existingAllocations, error: existingError } = await admin
    .from("allocations")
    .select("user_id, project_id, days_per_week, start_date, end_date")
    .eq("user_id", userId)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  if (isLead) {
    await assertWithinParallelLimit(admin, userId, projectId, startDateISO, projectEndDateISO);
  }

  let remaining = totalDays;
  let week = isoWeekRange(new Date(`${startDateISO}T00:00:00Z`));
  let weeksCreated = 0;
  let placedDays = 0;

  while (remaining >= 0.5 && week.start <= projectEndDateISO) {
    const allocatedThisWeek = monthlyDaysForUser(existingAllocations ?? [], userId, week);
    const weekCapacity = Math.max(0, profile.capacity_days - allocatedThisWeek);
    const thisWeekDays = Math.min(remaining, Math.floor(weekCapacity * 2) / 2);

    if (thisWeekDays >= 0.5) {
      const rowStart = week.start > startDateISO ? week.start : startDateISO;
      const rowEnd = week.end < projectEndDateISO ? week.end : projectEndDateISO;

      const { error } = await admin.from("allocations").insert({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        days_per_week: thisWeekDays,
        start_date: rowStart,
        end_date: rowEnd,
        priority,
        approval_status: isLead ? "approved" : "pending",
        proposed_by: isLead ? null : proposedBy,
      });
      if (error) throw new Error(error.message);

      weeksCreated++;
      placedDays += thisWeekDays;
      remaining -= thisWeekDays;
    }

    const nextMonday = new Date(`${week.start}T00:00:00Z`);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    week = isoWeekRange(nextMonday);
  }

  return { weeksCreated, placedDays, unplacedDays: Math.max(0, Math.round(remaining * 2) / 2) };
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

export async function createAllocation(
  input: unknown,
): Promise<{ weeksCreated: number; placedDays: number; unplacedDays: number }> {
  const profile = await requireRole(["qa_lead", "project_manager"]);

  const parsed = ScheduleAllocationInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("approval_status, end_date, total_working_days")
    .eq("id", parsed.data.project_id)
    .single();

  if (projectError || !project || project.approval_status !== "approved") {
    throw new Error("You can only assign testers to an approved project");
  }
  if (!project.end_date) {
    throw new Error("This item has no end date and can't be scheduled");
  }

  const { data: existingProjectAllocations, error: existingError } = await admin
    .from("allocations")
    .select("days_per_week, start_date, end_date")
    .eq("project_id", parsed.data.project_id)
    .eq("approval_status", "approved");
  if (existingError) throw new Error(existingError.message);

  const committed = (existingProjectAllocations ?? []).reduce(
    (sum, a) => sum + a.days_per_week * weeksBetween(a.start_date, a.end_date ?? project.end_date!),
    0,
  );
  const remainingDays = Math.max(0, project.total_working_days - committed);

  const isLead = profile.role === "qa_lead";

  return scheduleWeeklyAllocations({
    admin,
    userId: parsed.data.user_id,
    projectId: parsed.data.project_id,
    roleOnProject: parsed.data.role_on_project,
    priority: parsed.data.priority,
    totalDays: remainingDays,
    startDateISO: parsed.data.start_date,
    projectEndDateISO: project.end_date,
    isLead,
    proposedBy: isLead ? null : profile.id,
  });
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
 * A Project Manager's request to change dates/days/priority on an
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
 * Assigns one project/activity to several QAs at once — NOT split: each
 * selected QA is independently scheduled (via `scheduleWeeklyAllocations`)
 * against the project's *full* `total_working_days` remaining total, one
 * allocation row per week they're active, capped at their own real
 * capacity each week and spilling into following weeks as needed. QA-Lead
 * batches go live immediately (per-QA, subject to the parallel-limit
 * check); PM batches are standalone `pending` proposals, same rule as the
 * single-QA flow. Partial success is expected and reported — one QA
 * failing the limit check doesn't block the others.
 */
export async function createBulkAllocations(input: unknown): Promise<{
  created: { userId: string; weeksCreated: number; placedDays: number; unplacedDays: number }[];
  failed: { userId: string; reason: string }[];
}> {
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
    throw new Error("This item has no end date and can't be scheduled");
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
  const isLead = profile.role === "qa_lead";

  const created: { userId: string; weeksCreated: number; placedDays: number; unplacedDays: number }[] = [];
  const failed: { userId: string; reason: string }[] = [];

  for (const userId of parsed.data.user_ids) {
    try {
      const result = await scheduleWeeklyAllocations({
        admin,
        userId,
        projectId: parsed.data.project_id,
        roleOnProject: parsed.data.role_on_project,
        priority: "medium",
        totalDays: remainingDays,
        startDateISO: project.start_date,
        projectEndDateISO: project.end_date,
        isLead,
        proposedBy: isLead ? null : profile.id,
      });
      created.push({ userId, ...result });
    } catch (scheduleError) {
      failed.push({ userId, reason: (scheduleError as Error).message });
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

/** Distinct names of QAs already *approved* on this project, for display when picking a target project. */
export async function getAssignedQaNames(projectId: string): Promise<string[]> {
  const supabase = await createClient();

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("approval_status", "approved");
  if (error) throw new Error(error.message);

  const userIds = [...new Set((allocations ?? []).map((a) => a.user_id))];
  if (userIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("name")
    .in("id", userIds);
  if (profilesError) throw new Error(profilesError.message);

  return (profiles ?? []).map((p) => p.name);
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
