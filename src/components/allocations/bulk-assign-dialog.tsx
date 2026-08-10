"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBulkAllocations } from "@/features/allocation-action";
import { getAssignableProfiles } from "@/features/profile-action";
import { getProjects } from "@/features/project-action";
import { weeksBetween } from "@/lib/load";
import type { ProfileRole } from "@/lib/profile";

type BulkAssignDialogProps = {
  role: ProfileRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BulkAssignDialog({ role, open, onOpenChange }: BulkAssignDialogProps) {
  const [projectId, setProjectId] = useState("");
  const [roleOnProject, setRoleOnProject] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const { data: projects } = useQuery({
    queryKey: ["projects", { approvalStatus: "approved" }],
    queryFn: () => getProjects({ approvalStatus: "approved" }),
  });

  const { data: testers } = useQuery({
    queryKey: ["assignable-profiles"],
    queryFn: () => getAssignableProfiles(),
  });

  const selectedProject = (projects ?? []).find((p) => p.id === projectId) ?? null;

  const previewHoursPerWeek = useMemo(() => {
    if (!selectedProject || !selectedProject.end_date || selectedUserIds.length === 0) return null;
    const weeks = weeksBetween(selectedProject.start_date, selectedProject.end_date);
    return selectedProject.total_working_hours / selectedUserIds.length / weeks;
  }, [selectedProject, selectedUserIds.length]);

  const mutation = useMutation({
    mutationFn: () =>
      createBulkAllocations({
        project_id: projectId,
        user_ids: selectedUserIds,
        role_on_project: roleOnProject,
      }),
    onSuccess: (result) => {
      if (result.created.length > 0) {
        toast.success(
          role === "qa_lead"
            ? `Assigned ${result.created.length} QA member(s)`
            : `Proposed assignment for ${result.created.length} QA member(s) — pending QA Lead approval`,
        );
      }
      if (result.failed.length > 0) {
        const names = result.failed
          .map((f) => (testers ?? []).find((t) => t.id === f.userId)?.name ?? f.userId)
          .join(", ");
        toast.error(`Could not assign: ${names}`);
      }
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations"] });
      setProjectId("");
      setRoleOnProject("");
      setSelectedUserIds([]);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function toggleUser(userId: string, checked: boolean) {
    setSelectedUserIds((current) => (checked ? [...current, userId] : current.filter((id) => id !== userId)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add project (even split)</DialogTitle>
          <DialogDescription>
            Total working hours are split evenly across the QA members you select.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="bulk_project">Project / Activity</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="bulk_project" className="w-full">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {(projects ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk_role">Role on Project</Label>
            <Input id="bulk_role" value={roleOnProject} onChange={(e) => setRoleOnProject(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label>QA Members</Label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
              {(testers ?? []).map((tester) => (
                <label key={tester.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedUserIds.includes(tester.id)}
                    onCheckedChange={(checked) => toggleUser(tester.id, checked === true)}
                  />
                  {tester.name}
                </label>
              ))}
            </div>
          </div>

          {previewHoursPerWeek !== null && (
            <p className="text-sm text-muted-foreground">
              Each selected QA gets ~{previewHoursPerWeek.toFixed(1)} hrs/week.
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={!projectId || selectedUserIds.length === 0 || mutation.isPending}>
              {mutation.isPending ? "Assigning..." : "Assign selected"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
