"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAssignableProfiles } from "@/features/profile-action";
import { proposeProject } from "@/features/project-action";
import type { Product, ProjectStatus } from "@/lib/project";

type AllocationRow = {
  user_id: string;
  role_on_project: string;
  hours_per_week: string;
  start_date: string;
  end_date: string;
};

function emptyAllocationRow(): AllocationRow {
  return { user_id: "", role_on_project: "", hours_per_week: "8", start_date: "", end_date: "" };
}

type ProposeProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProposeProjectDialog({ open, onOpenChange }: ProposeProjectDialogProps) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [product, setProduct] = useState<Product>("qris_h2h");
  const [status, setStatus] = useState<ProjectStatus>("to_do");
  const [rows, setRows] = useState<AllocationRow[]>([emptyAllocationRow()]);
  const queryClient = useQueryClient();

  const { data: testers } = useQuery({
    queryKey: ["assignable-profiles"],
    queryFn: () => getAssignableProfiles(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      proposeProject({
        project: {
          name,
          start_date: startDate,
          end_date: endDate || undefined,
          product,
          status,
          progress_percent: 0,
        },
        allocations: rows.map((row) => ({
          user_id: row.user_id,
          role_on_project: row.role_on_project,
          hours_per_week: Number(row.hours_per_week),
          start_date: row.start_date,
          end_date: row.end_date || undefined,
        })),
      }),
    onSuccess: () => {
      toast.success("Proposal submitted — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setStartDate("");
      setEndDate("");
      setRows([emptyAllocationRow()]);
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function updateRow(index: number, patch: Partial<AllocationRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Propose project</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="proposal_name">Project Name</Label>
            <Input id="proposal_name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_start">Start Date</Label>
              <Input id="proposal_start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_end">End Date</Label>
              <Input id="proposal_end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_product">Product</Label>
              <Select value={product} onValueChange={(value) => setProduct(value as Product)}>
                <SelectTrigger id="proposal_product" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qris_h2h">QRIS H2H</SelectItem>
                  <SelectItem value="qris_bo">QRIS BO</SelectItem>
                  <SelectItem value="qrcb">QRCB</SelectItem>
                  <SelectItem value="pi">PI</SelectItem>
                  <SelectItem value="jv">JV</SelectItem>
                  <SelectItem value="ccw">CCW</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as ProjectStatus)}>
                <SelectTrigger id="proposal_status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="to_do">To Do</SelectItem>
                  <SelectItem value="ready_sit">Ready to SIT</SelectItem>
                  <SelectItem value="sit">SIT</SelectItem>
                  <SelectItem value="ready_uat">Ready to UAT</SelectItem>
                  <SelectItem value="uat">UAT</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Tester Assignments</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, emptyAllocationRow()])}>
                <Plus className="size-4" />
                Add tester
              </Button>
            </div>

            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-12 items-end gap-2 rounded-md border p-3">
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Tester</Label>
                  <Select value={row.user_id} onValueChange={(value) => updateRow(index, { user_id: value })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(testers ?? []).map((tester) => (
                        <SelectItem key={tester.id} value={tester.id}>
                          {tester.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">Role</Label>
                  <Input value={row.role_on_project} onChange={(e) => updateRow(index, { role_on_project: e.target.value })} required />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Hrs/Wk</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={row.hours_per_week}
                    onChange={(e) => updateRow(index, { hours_per_week: e.target.value })}
                    required
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Start</Label>
                  <Input type="date" value={row.start_date} onChange={(e) => updateRow(index, { start_date: e.target.value })} required />
                </div>
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs">End</Label>
                  <Input type="date" value={row.end_date} onChange={(e) => updateRow(index, { end_date: e.target.value })} />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={rows.length === 1}
                    onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
                    aria-label="Remove tester row"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Submitting..." : "Submit proposal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
