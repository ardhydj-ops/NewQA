"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isoWeekRange,
  monthRange,
  weeklyHoursForUser,
  weeklyLoadPercent,
  monthlyHoursForUser,
  monthlyHoursForProject,
  type AllocationForCalc,
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
  topDemand: { project: Project; hours: number }[];
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

  const topDemand = projects
    .map((project) => ({ project, hours: hoursByProject.get(project.id) ?? 0 }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  return {
    totalCapacity,
    totalAllocated,
    availableCapacity: totalCapacity - totalAllocated,
    resourceLoad,
    topDemand,
  };
}

export type MonthlyMemberRow = { profile: Profile; hours: number };
export type MonthlyProjectRow = { project: Project; hours: number };

export async function getMonthlyDashboard(
  year: number,
  monthIndex0: number,
): Promise<{ perMember: MonthlyMemberRow[]; perProject: MonthlyProjectRow[] }> {
  const month = monthRange(year, monthIndex0);
  const [resources, allocations] = await Promise.all([
    getActiveResources(),
    getApprovedAllocationsInRange(month.start, month.end),
  ]);

  const perMember = resources
    .map((profile) => ({ profile, hours: monthlyHoursForUser(allocations, profile.id, month) }))
    .sort((a, b) => b.hours - a.hours);

  const projectIds = [...new Set(allocations.map((a) => a.project_id))];
  const projects = await getProjectsByIds(projectIds);

  const perProject = projects
    .map((project) => ({ project, hours: monthlyHoursForProject(allocations, project.id, month) }))
    .sort((a, b) => b.hours - a.hours);

  return { perMember, perProject };
}
