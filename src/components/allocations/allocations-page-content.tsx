"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadBar } from "@/components/ui/load-bar";
import { AllocationForm } from "@/components/allocations/allocation-form";
import { AssignmentsTable } from "@/components/allocations/assignments-table";
import { getWeeklyDashboard } from "@/features/dashboard-action";
import { getProjects } from "@/features/project-action";
import { isoWeekRange } from "@/lib/load";
import type { ProfileRole } from "@/lib/profile";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

export function AllocationsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const canWrite = role === "qa_lead" || role === "project_manager";

  const { data: dashboard, isLoading: loadLoading } = useQuery({
    queryKey: ["weekly-dashboard", weekStart],
    queryFn: () => getWeeklyDashboard(weekStart),
  });

  // Fetch all projects (not just approved) so pending-project-proposal
  // allocations can still resolve a project name in the assignments table;
  // the picker below filters back down to approved-only itself.
  const { data: allProjects } = useQuery({
    queryKey: ["projects", {}],
    queryFn: () => getProjects(),
  });
  const approvedProjects = (allProjects ?? []).filter((p) => p.approval_status === "approved");

  const resources = dashboard?.resourceLoad ?? [];
  const filteredResources = useMemo(
    () => resources.filter((r) => r.profile.name.toLowerCase().includes(search.trim().toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on dashboard (stable query cache reference), not the derived `resources` array literal
    [dashboard, search],
  );

  const selected = resources.find((r) => r.profile.id === selectedUserId) ?? null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Allocation Tool</h1>
        <p className="text-sm text-muted-foreground">Assign QA resources to approved projects and manage capacity.</p>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="week-start" className="text-sm text-muted-foreground">
          Planning week of
        </label>
        <Input
          id="week-start"
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(mondayOf(new Date(`${e.target.value}T00:00:00Z`)))}
          className="w-40"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Select Resource</h2>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search QA members..."
                className="pl-9"
              />
            </div>
            <div className="space-y-2">
              {loadLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredResources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No resources found.</p>
              ) : (
                filteredResources.map((r) => (
                  <button
                    key={r.profile.id}
                    type="button"
                    onClick={() => setSelectedUserId(r.profile.id)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      selectedUserId === r.profile.id ? "border-blue-600 bg-blue-50" : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{r.profile.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.allocatedHours}/{r.profile.capacity_hours} hrs
                      </span>
                    </div>
                    <LoadBar percent={r.loadPercent} className="mt-2" />
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Allocation Details</h2>
            {!selected ? (
              <p className="text-sm text-muted-foreground">Select a resource to assign work.</p>
            ) : canWrite ? (
              <AllocationForm
                userId={selected.profile.id}
                userName={selected.profile.name}
                capacityHours={selected.profile.capacity_hours}
                allocatedHours={selected.allocatedHours}
                projects={approvedProjects}
                role={role}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {selected.profile.name} — {selected.allocatedHours}/{selected.profile.capacity_hours} hrs this week.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {selected && (
        <AssignmentsTable
          userId={selected.profile.id}
          userName={selected.profile.name}
          projects={allProjects ?? []}
          role={role}
          currentProfileId={currentProfileId}
        />
      )}
    </div>
  );
}
