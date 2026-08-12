"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadBar } from "@/components/ui/load-bar";
import { AllocationForm } from "@/components/allocations/allocation-form";
import { AssignmentsTable } from "@/components/allocations/assignments-table";
import { BulkAssignDialog } from "@/components/allocations/bulk-assign-dialog";
import { getRangeDashboard, type ResourceLoadRow } from "@/features/dashboard-action";
import { getProjects } from "@/features/project-action";
import { getQaGroups } from "@/features/qa-group-action";
import { isoWeekRange } from "@/lib/load";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";

function mondayOf(date: Date): string {
  return isoWeekRange(date).start;
}

function sundayOf(date: Date): string {
  return isoWeekRange(date).end;
}

export function AllocationsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [rangeStart, setRangeStart] = useState(() => mondayOf(new Date()));
  const [rangeEnd, setRangeEnd] = useState(() => sundayOf(new Date()));
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  const canWrite = QA_LEAD_ROLES.includes(role) || role === "project_manager";
  const validRange = rangeStart <= rangeEnd;

  const { data: dashboard, isLoading: loadLoading } = useQuery({
    queryKey: ["range-dashboard", rangeStart, rangeEnd],
    queryFn: () => getRangeDashboard(rangeStart, rangeEnd),
    enabled: validRange,
  });

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });

  // Fetch all projects (not just approved) so pending-project-proposal
  // allocations can still resolve a project name in the assignments table;
  // the pickers below filter back down to approved-only themselves.
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

  const groupedResources = useMemo(() => {
    const groups = (qaGroups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      members: filteredResources.filter((r) => r.profile.qa_group_id === group.id),
    }));
    const unassigned = filteredResources.filter((r) => r.profile.qa_group_id === null);
    return unassigned.length > 0 ? [...groups, { id: "unassigned", name: "Unassigned", members: unassigned }] : groups;
  }, [qaGroups, filteredResources]);

  const selected = resources.find((r) => r.profile.id === selectedUserId) ?? null;

  function renderResourceButton(r: ResourceLoadRow) {
    return (
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
            {Math.round(r.allocatedDays * 2) / 2}/{r.profile.capacity_days} days
          </span>
        </div>
        <LoadBar percent={r.loadPercent} className="mt-2" />
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Allocation Tool</h1>
          <p className="text-sm text-muted-foreground">Assign QA resources to approved projects and manage capacity.</p>
        </div>
        {canWrite && (
          <Button onClick={() => setBulkAssignOpen(true)}>
            <Plus className="size-4" />
            Add Project
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="range-start" className="text-sm text-muted-foreground">
            Planning period — Start
          </label>
          <Input
            id="range-start"
            type="date"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="range-end" className="text-sm text-muted-foreground">
            End
          </label>
          <Input
            id="range-end"
            type="date"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            className="w-40"
          />
        </div>
        {!validRange && <p className="text-sm text-rose-600">End date must be on or after start date.</p>}
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
            <div className="space-y-4">
              {loadLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredResources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No resources found.</p>
              ) : (
                groupedResources
                  .filter((group) => group.members.length > 0)
                  .map((group) => (
                    <div key={group.id} className="space-y-2">
                      <h3 className="text-xs font-medium uppercase text-muted-foreground">{group.name}</h3>
                      <div className="space-y-2">{group.members.map(renderResourceButton)}</div>
                    </div>
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
                capacityDays={selected.profile.capacity_days}
                allocatedDays={selected.allocatedDays}
                projects={approvedProjects}
                role={role}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {selected.profile.name} — {Math.round(selected.allocatedDays * 2) / 2}/
                {selected.profile.capacity_days} days avg/week.
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

      {canWrite && <BulkAssignDialog role={role} open={bulkAssignOpen} onOpenChange={setBulkAssignOpen} />}
    </div>
  );
}
