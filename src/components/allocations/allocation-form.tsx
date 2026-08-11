"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAllocation, getRemainingProjectHours, getRemainingUserCapacity } from "@/features/allocation-action";
import { weeksBetween } from "@/lib/load";
import type { Priority, Project } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

type AllocationFormProps = {
  userId: string;
  userName: string;
  capacityHours: number;
  allocatedHours: number;
  projects: Project[];
  role: ProfileRole;
};

export function AllocationForm({ userId, userName, capacityHours, allocatedHours, projects, role }: AllocationFormProps) {
  const [projectId, setProjectId] = useState("");
  const [roleOnProject, setRoleOnProject] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const queryClient = useQueryClient();

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  const { data: remainingHours } = useQuery({
    queryKey: ["remaining-project-hours", projectId],
    queryFn: () => getRemainingProjectHours(projectId),
    enabled: projectId !== "",
  });

  function handleProjectChange(value: string) {
    setProjectId(value);
    const project = projects.find((p) => p.id === value);
    setStartDate(project?.start_date ?? "");
    setEndDate(project?.end_date ?? "");
  }

  const validDates = startDate !== "" && endDate !== "" && endDate >= startDate;

  const { data: rangeRemainingCapacity } = useQuery({
    queryKey: ["remaining-user-capacity", userId, startDate, endDate],
    queryFn: () => getRemainingUserCapacity(userId, startDate, endDate),
    enabled: validDates,
  });

  // Once dates are picked, base remaining capacity on the QA's load over
  // those specific dates rather than the page's own planning-period range —
  // this stays correct even when the item spans multiple weeks.
  const remainingCapacity =
    validDates && rangeRemainingCapacity !== undefined
      ? rangeRemainingCapacity
      : Math.max(0, capacityHours - allocatedHours);
  const weeks = validDates ? weeksBetween(startDate, endDate) : null;
  const computedHoursPerWeek = remainingHours !== undefined && weeks !== null ? remainingHours / weeks : null;
  const overCapacity = computedHoursPerWeek !== null && computedHoursPerWeek > remainingCapacity;
  const canSubmit =
    projectId !== "" && roleOnProject.trim() !== "" && computedHoursPerWeek !== null && computedHoursPerWeek > 0 && !overCapacity;

  const mutation = useMutation({
    mutationFn: () =>
      createAllocation({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        hours_per_week: computedHoursPerWeek!,
        start_date: startDate,
        end_date: endDate || undefined,
        priority,
      }),
    onSuccess: () => {
      toast.success(role === "qa_lead" ? "Resource assigned" : "Assignment proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["range-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      queryClient.invalidateQueries({ queryKey: ["remaining-project-hours", projectId] });
      queryClient.invalidateQueries({ queryKey: ["remaining-user-capacity", userId] });
      setProjectId("");
      setRoleOnProject("");
      setStartDate("");
      setEndDate("");
      setPriority("medium");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="space-y-4"
    >
      <div className="rounded-md border bg-muted px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Selected Resource</span>
          <span className="font-medium">{userName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Remaining Capacity</span>
          <span className="font-medium">{Math.round(remainingCapacity * 10) / 10} hrs / week</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project">Target Project</Label>
        <Select value={projectId} onValueChange={handleProjectChange}>
          <SelectTrigger id="project" className="w-full">
            <SelectValue placeholder="Select a project..." />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedProject && (
          <p className="text-xs text-muted-foreground">
            Remaining hours for this item:{" "}
            {remainingHours !== undefined ? `${Math.round(remainingHours * 10) / 10} hrs` : "..."}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="role_on_project">Role on Project</Label>
        <Input
          id="role_on_project"
          value={roleOnProject}
          onChange={(e) => setRoleOnProject(e.target.value)}
          placeholder="e.g. Lead QA"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="priority">Priority</Label>
        <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
          <SelectTrigger id="priority" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start_date">Start</Label>
          <Input
            id="start_date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            min={selectedProject?.start_date}
            max={selectedProject?.end_date ?? undefined}
            required
            disabled={!projectId}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end_date">End</Label>
          <Input
            id="end_date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={selectedProject?.start_date}
            max={selectedProject?.end_date ?? undefined}
            required
            disabled={!projectId}
          />
        </div>
      </div>

      {startDate !== "" && endDate !== "" && endDate < startDate && (
        <p className="text-sm text-rose-600">End date must be on or after start date.</p>
      )}

      {computedHoursPerWeek !== null && (
        <p className={`text-sm ${overCapacity ? "text-rose-600" : "text-muted-foreground"}`}>
          This will allocate ~{Math.round(computedHoursPerWeek * 10) / 10} hrs/week.
          {overCapacity &&
            ` This QA only has ${Math.round(remainingCapacity * 10) / 10} hrs/week available — widen the date range or pick a different QA.`}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? "Assigning..." : role === "qa_lead" ? "Assign Resource" : "Propose Assignment"}
        </Button>
      </div>
    </form>
  );
}
