"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isoWeekRange,
  monthRange,
  weeklyDaysForUser,
  weeklyLoadPercent,
  monthlyDaysForUser as rangeDaysForUser,
  weeksBetween,
  type AllocationForCalc,
  type DateRange,
} from "@/lib/load";
import type { Profile } from "@/lib/profile";
import type { Project } from "@/lib/project";

const RESOURCE_ROLES = ["qa_lead", "qa_member"] as const;

async function getActiveResources(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_active", true)
    .in("role", RESOURCE_ROLES);
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

async function getApprovedAllocationsInRange(
  start: string,
  end: string,
): Promise<(AllocationForCalc & { product_id: string })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("user_id, project_id, product_id, days_per_week, start_date, end_date")
    .eq("approval_status", "approved")
    .lte("start_date", end)
    .or(`end_date.is.null,end_date.gte.${start}`);
  if (error) throw new Error(error.message);
  return (data ?? []) as (AllocationForCalc & { product_id: string })[];
}

export type ResourceLoadRow = {
  profile: Profile;
  allocatedDays: number;
  loadPercent: number;
};

export type WeeklyDashboard = {
  totalCapacity: number;
  totalAllocated: number;
  availableCapacity: number;
  resourceLoad: ResourceLoadRow[];
  demandByProduct: { productId: string; days: number }[];
};

export async function getWeeklyDashboard(weekStartISO: string): Promise<WeeklyDashboard> {
  const week = isoWeekRange(new Date(`${weekStartISO}T00:00:00Z`));
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(week.start, week.end),
  ]);

  const resourceLoad: ResourceLoadRow[] = resources.map((profile) => {
    const allocatedDays = weeklyDaysForUser(allocations, profile.id, week);
    return {
      profile,
      allocatedDays,
      loadPercent: weeklyLoadPercent(allocatedDays, profile.capacity_days),
    };
  });

  const totalCapacity = resources.reduce((sum, p) => sum + p.capacity_days, 0);
  const totalAllocated = resourceLoad.reduce((sum, r) => sum + r.allocatedDays, 0);

  const daysByProductId = new Map<string, number>();
  for (const allocation of allocations) {
    daysByProductId.set(
      allocation.product_id,
      (daysByProductId.get(allocation.product_id) ?? 0) + allocation.days_per_week,
    );
  }
  const demandByProduct = [...daysByProductId.entries()]
    .map(([productId, days]) => ({ productId, days }))
    .sort((a, b) => b.days - a.days);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    demandByProduct,
  };
}

/**
 * Same shape as `getWeeklyDashboard`, but for an arbitrary [start, end] range
 * instead of one fixed ISO week — `allocatedDays` per QA (and `days` per
 * product in `demandByProduct`) is the range's total prorated days divided
 * by how many weeks the range spans, i.e. an average days/week figure, so the
 * existing 80%/100% load thresholds and days/wk-labeled UI keep meaning
 * unchanged no matter how wide a range is picked.
 */
export async function getRangeDashboard(startDateISO: string, endDateISO: string): Promise<WeeklyDashboard> {
  if (startDateISO > endDateISO) {
    throw new Error("End date must be on or after start date");
  }

  const range: DateRange = { start: startDateISO, end: endDateISO };
  const weeks = weeksBetween(startDateISO, endDateISO);
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(range.start, range.end),
  ]);

  const resourceLoad: ResourceLoadRow[] = resources.map((profile) => {
    const allocatedDays = rangeDaysForUser(allocations, profile.id, range) / weeks;
    return {
      profile,
      allocatedDays,
      loadPercent: weeklyLoadPercent(allocatedDays, profile.capacity_days),
    };
  });

  const totalCapacity = resources.reduce((sum, p) => sum + p.capacity_days, 0);
  const totalAllocated = resourceLoad.reduce((sum, r) => sum + r.allocatedDays, 0);

  const daysByProductId = new Map<string, number>();
  for (const allocation of allocations) {
    const days = rangeDaysForUser([allocation], allocation.user_id, range) / weeks;
    daysByProductId.set(allocation.product_id, (daysByProductId.get(allocation.product_id) ?? 0) + days);
  }
  const demandByProduct = [...daysByProductId.entries()]
    .map(([productId, days]) => ({ productId, days }))
    .sort((a, b) => b.days - a.days);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    demandByProduct,
  };
}

/**
 * A QA's approved, non-completed items overlapping the given week — the
 * detail behind their "Capacity by QA Group" row on the Dashboard.
 */
export async function getInProgressProjectsForUser(userId: string, weekStartISO: string): Promise<Project[]> {
  const week = isoWeekRange(new Date(`${weekStartISO}T00:00:00Z`));
  const supabase = await createClient();

  const { data: allocations, error } = await supabase
    .from("allocations")
    .select("project_id")
    .eq("user_id", userId)
    .eq("approval_status", "approved")
    .lte("start_date", week.end)
    .or(`end_date.is.null,end_date.gte.${week.start}`);
  if (error) throw new Error(error.message);

  const projectIds = [...new Set((allocations ?? []).map((a) => a.project_id))];
  if (projectIds.length === 0) return [];

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("*, project_products(product_id)")
    .in("id", projectIds)
    .neq("status", "completed");
  if (projectsError) throw new Error(projectsError.message);
  return (projects ?? []).map((row) => {
    const { project_products, ...project } = row as Project & { project_products: { product_id: string }[] };
    return { ...project, product_ids: project_products.map((pp) => pp.product_id) };
  });
}

/** Approved work items overlapping the given month, for the Dashboard's calendar view. */
export async function getProjectsForMonth(year: number, monthIndex0: number): Promise<Project[]> {
  const month = monthRange(year, monthIndex0);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*, project_products(product_id)")
    .eq("approval_status", "approved")
    .lte("start_date", month.end)
    .or(`end_date.is.null,end_date.gte.${month.start}`);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const { project_products, ...project } = row as Project & { project_products: { product_id: string }[] };
    return { ...project, product_ids: project_products.map((pp) => pp.product_id) };
  });
}

/** project_id -> distinct user_ids with an approved allocation overlapping the month. */
export async function getMonthAllocationAssignments(
  year: number,
  monthIndex0: number,
): Promise<Record<string, string[]>> {
  const month = monthRange(year, monthIndex0);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("project_id, user_id")
    .eq("approval_status", "approved")
    .lte("start_date", month.end)
    .or(`end_date.is.null,end_date.gte.${month.start}`);
  if (error) throw new Error(error.message);

  const map: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const users = (map[row.project_id] ??= []);
    if (!users.includes(row.user_id)) users.push(row.user_id);
  }
  return map;
}
