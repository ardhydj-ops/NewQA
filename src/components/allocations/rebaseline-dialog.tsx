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
import { proposeAllocationChange, updateAllocation } from "@/features/allocation-action";
import type { Allocation } from "@/lib/allocation";
import type { Priority } from "@/lib/project";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";

type RebaselineDialogProps = {
  allocation: Allocation;
  role: ProfileRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RebaselineDialog({ allocation, role, open, onOpenChange }: RebaselineDialogProps) {
  const [startDate, setStartDate] = useState(allocation.start_date);
  const [endDate, setEndDate] = useState(allocation.end_date ?? "");
  const [daysPerWeek, setDaysPerWeek] = useState(String(allocation.days_per_week));
  const [priority, setPriority] = useState<Priority>(allocation.priority);
  const queryClient = useQueryClient();

  const isLead = QA_LEAD_ROLES.includes(role);

  const mutation = useMutation({
    mutationFn: () =>
      isLead
        ? updateAllocation(allocation.id, {
            user_id: allocation.user_id,
            project_id: allocation.project_id,
            role_on_project: allocation.role_on_project,
            days_per_week: Number(daysPerWeek),
            start_date: startDate,
            end_date: endDate || undefined,
            priority,
          })
        : proposeAllocationChange(allocation.id, {
            days_per_week: Number(daysPerWeek),
            start_date: startDate,
            end_date: endDate || undefined,
            priority,
          }),
    onSuccess: () => {
      toast.success(isLead ? "Assignment updated" : "Change proposed — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", allocation.user_id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projects-for-month"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rebaseline assignment</DialogTitle>
          {!isLead && (
            <DialogDescription>Changes here need QA Lead approval before they take effect.</DialogDescription>
          )}
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="rebaseline_days">Allocated Days (Weekly)</Label>
            <Input
              id="rebaseline_days"
              type="number"
              min={0.5}
              step={0.5}
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rebaseline_start">Start</Label>
              <Input id="rebaseline_start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rebaseline_end">End</Label>
              <Input id="rebaseline_end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rebaseline_priority">Priority</Label>
            <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
              <SelectTrigger id="rebaseline_priority" className="w-full">
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
              {mutation.isPending ? "Saving..." : isLead ? "Save" : "Propose change"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
