"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAllocation } from "@/features/allocation-action";
import type { Allocation } from "@/lib/allocation";

type AllocationEditDialogProps = {
  allocation: Allocation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AllocationEditDialog({ allocation, open, onOpenChange }: AllocationEditDialogProps) {
  const [roleOnProject, setRoleOnProject] = useState(allocation.role_on_project);
  const [hoursPerWeek, setHoursPerWeek] = useState(String(allocation.hours_per_week));
  const [startDate, setStartDate] = useState(allocation.start_date);
  const [endDate, setEndDate] = useState(allocation.end_date ?? "");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      updateAllocation(allocation.id, {
        user_id: allocation.user_id,
        project_id: allocation.project_id,
        role_on_project: roleOnProject,
        hours_per_week: Number(hoursPerWeek),
        start_date: startDate,
        end_date: endDate || undefined,
      }),
    onSuccess: () => {
      toast.success("Assignment updated");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", allocation.user_id] });
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit assignment</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="edit_role">Role on Project</Label>
            <Input id="edit_role" value={roleOnProject} onChange={(e) => setRoleOnProject(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit_hours">Allocated Hours (Weekly)</Label>
            <Input
              id="edit_hours"
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
              <Label htmlFor="edit_start">Start</Label>
              <Input id="edit_start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_end">End</Label>
              <Input id="edit_end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
