"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isoWeekRange,
  monthRange,
  weeklyHoursForUser,
  weeklyLoadPercent,
  monthlyHoursForUser as rangeHoursForUser,
  monthlyHoursForProject as rangeHoursForProject,
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

async function getApprovedAllocationsInRange(start: string, end: string): Promise<AllocationForCalc[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("allocations")
    .select("user_id, project_id, hours_per_week, start_date, end_date")
    .eq("approval_status", "approved")
    .lte("start_date", end)
    .or(`end_date.is.null,end_date.gte.${start}`);
  if (error) throw new Error(error.message);
  return (data ?? []) as AllocationForCalc[];
}

async function getProjectsByIds(ids: string[]): Promise<Project[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}

export type ResourceLoadRow = {
  profile: Profile;
  allocatedHours: number;
  loadPercent: number;
};

export type WeeklyDashboard = {
  totalCapacity: number;
  totalAllocated: number;
  availableCapacity: number;
  resourceLoad: ResourceLoadRow[];
  demandByProduct: { productId: string; hours: number }[];
};

export async function getWeeklyDashboard(weekStartISO: string): Promise<WeeklyDashboard> {
  const week = isoWeekRange(new Date(`${weekStartISO}T00:00:00Z`));
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(week.start, week.end),
  ]);

  const resourceLoad: ResourceLoadRow[] = resources.map((profile) => {
    const allocatedHours = weeklyHoursForUser(allocations, profile.id, week);
    return {
      profile,
      allocatedHours,
      loadPercent: weeklyLoadPercent(allocatedHours, profile.capacity_hours),
    };
  });

  const totalCapacity = resources.reduce((sum, p) => sum + p.capacity_hours, 0);
  const totalAllocated = resourceLoad.reduce((sum, r) => sum + r.allocatedHours, 0);

  const hoursByProject = new Map<string, number>();
  for (const allocation of allocations) {
    hoursByProject.set(allocation.project_id, (hoursByProject.get(allocation.project_id) ?? 0) + allocation.hours_per_week);
  }

  const projectIds = [...hoursByProject.keys()];
  const projects = await getProjectsByIds(projectIds);

  const hoursByProductId = new Map<string, number>();
  for (const project of projects) {
    const hours = hoursByProject.get(project.id) ?? 0;
    hoursByProductId.set(project.product_id, (hoursByProductId.get(project.product_id) ?? 0) + hours);
  }
  const demandByProduct = [...hoursByProductId.entries()]
    .map(([productId, hours]) => ({ productId, hours }))
    .sort((a, b) => b.hours - a.hours);

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
 * instead of one fixed ISO week — `allocatedHours` per QA (and `hours` per
 * product in `demandByProduct`) is the range's total prorated hours divided
 * by how many weeks the range spans, i.e. an average hrs/week figure, so the
 * existing 80%/100% load thresholds and hrs/wk-labeled UI keep meaning
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
    const allocatedHours = rangeHoursForUser(allocations, profile.id, range) / weeks;
    return {
      profile,
      allocatedHours,
      loadPercent: weeklyLoadPercent(allocatedHours, profile.capacity_hours),
    };
  });

  const totalCapacity = resources.reduce((sum, p) => sum + p.capacity_hours, 0);
  const totalAllocated = resourceLoad.reduce((sum, r) => sum + r.allocatedHours, 0);

  const projectIds = [...new Set(allocations.map((a) => a.project_id))];
  const projects = await getProjectsByIds(projectIds);

  const hoursByProductId = new Map<string, number>();
  for (const project of projects) {
    const hours = rangeHoursForProject(allocations, project.id, range) / weeks;
    hoursByProductId.set(project.product_id, (hoursByProductId.get(project.product_id) ?? 0) + hours);
  }
  const demandByProduct = [...hoursByProductId.entries()]
    .map(([productId, hours]) => ({ productId, hours }))
    .sort((a, b) => b.hours - a.hours);

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
    .select("*")
    .in("id", projectIds)
    .neq("status", "completed");
  if (projectsError) throw new Error(projectsError.message);
  return (projects ?? []) as Project[];
}

/** Approved work items overlapping the given month, for the Dashboard's calendar view. */
export async function getProjectsForMonth(year: number, monthIndex0: number): Promise<Project[]> {
  const month = monthRange(year, monthIndex0);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("approval_status", "approved")
    .lte("start_date", month.end)
    .or(`end_date.is.null,end_date.gte.${month.start}`);
  if (error) throw new Error(error.message);
  return (data ?? []) as Project[];
}
