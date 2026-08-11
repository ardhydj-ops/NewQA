"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { proposeProjectChange } from "@/features/project-action";
import type { Priority, Project } from "@/lib/project";

type ProjectRebaselineDialogProps = {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectRebaselineDialog({ project, open, onOpenChange }: ProjectRebaselineDialogProps) {
  const [startDate, setStartDate] = useState(project.start_date);
  const [endDate, setEndDate] = useState(project.end_date ?? "");
  const [totalWorkingDays, setTotalWorkingDays] = useState(String(project.total_working_days));
  const [priority, setPriority] = useState<Priority>(project.priority);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      proposeProjectChange(project.id, {
        start_date: startDate,
        end_date: endDate,
        total_working_days: Number(totalWorkingDays),
        priority,
      }),
    onSuccess: () => {
      toast.success("Change proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rebaseline item</DialogTitle>
          <DialogDescription>Changes here need QA Lead approval before they take effect.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rebaseline_project_start">Start Date</Label>
              <Input
                id="rebaseline_project_start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rebaseline_project_end">End Date</Label>
              <Input
                id="rebaseline_project_end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rebaseline_project_days">Total Working Days</Label>
            <Input
              id="rebaseline_project_days"
              type="number"
              min={0.5}
              step={0.5}
              value={totalWorkingDays}
              onChange={(e) => setTotalWorkingDays(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rebaseline_project_priority">Priority</Label>
            <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
              <SelectTrigger id="rebaseline_project_priority" className="w-full">
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
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Submitting..." : "Propose change"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
