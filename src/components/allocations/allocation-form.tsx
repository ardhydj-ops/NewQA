"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { createAllocation } from "@/features/allocation-action";
import type { Project } from "@/lib/project";
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
  const [hoursPerWeek, setHoursPerWeek] = useState("8");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      createAllocation({
        user_id: userId,
        project_id: projectId,
        role_on_project: roleOnProject,
        hours_per_week: Number(hoursPerWeek),
        start_date: startDate,
        end_date: endDate || undefined,
      }),
    onSuccess: () => {
      toast.success(role === "qa_lead" ? "Resource assigned" : "Assignment proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      setProjectId("");
      setRoleOnProject("");
      setHoursPerWeek("8");
      setStartDate("");
      setEndDate("");
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
          <span className="font-medium">{Math.max(0, capacityHours - allocatedHours)} hrs / week</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project">Target Project</Label>
        <Select value={projectId} onValueChange={setProjectId}>
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
        <Label htmlFor="hours">Allocated Hours (Weekly)</Label>
        <Input
          id="hours"
          type="number"
          min={1}
          step={1}
          value={hoursPerWeek}
          onChange={(e) => setHoursPerWeek(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start_date">Start</Label>
          <Input id="start_date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end_date">End</Label>
          <Input id="end_date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!projectId || mutation.isPending}>
          {mutation.isPending ? "Assigning..." : role === "qa_lead" ? "Assign Resource" : "Propose Assignment"}
        </Button>
      </div>
    </form>
  );
}
