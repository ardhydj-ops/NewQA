"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getProjectManagers } from "@/features/profile-action";
import { assignProjectPm } from "@/features/project-action";
import type { Project } from "@/lib/project";

type AssignPmDialogProps = {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AssignPmDialog({ project, open, onOpenChange }: AssignPmDialogProps) {
  const [pmId, setPmId] = useState(project.pm_id ?? "unassigned");
  const queryClient = useQueryClient();

  const { data: projectManagers } = useQuery({
    queryKey: ["project-managers"],
    queryFn: () => getProjectManagers(),
  });

  const mutation = useMutation({
    mutationFn: () => assignProjectPm(project.id, pmId === "unassigned" ? null : pmId),
    onSuccess: () => {
      toast.success("PM updated");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign PM — {project.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="assign_pm">Project Manager</Label>
          <Select value={pmId} onValueChange={setPmId}>
            <SelectTrigger id="assign_pm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {(projectManagers ?? []).map((pm) => (
                <SelectItem key={pm.id} value={pm.id}>
                  {pm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
