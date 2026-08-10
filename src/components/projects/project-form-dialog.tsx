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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProject, updateProject } from "@/features/project-action";
import type { ItemType, Priority, Product, Project, ProjectStatus } from "@/lib/project";

type FormState = {
  name: string;
  item_type: ItemType;
  start_date: string;
  end_date: string;
  product: Product;
  status: ProjectStatus;
  progress_percent: string;
  total_working_hours: string;
  priority: Priority;
};

function formFromProject(project?: Project): FormState {
  return project
    ? {
        name: project.name,
        item_type: project.item_type,
        start_date: project.start_date,
        end_date: project.end_date ?? "",
        product: project.product,
        status: project.status,
        progress_percent: String(project.progress_percent),
        total_working_hours: String(project.total_working_hours),
        priority: project.priority,
      }
    : {
        name: "",
        item_type: "project",
        start_date: "",
        end_date: "",
        product: "qris_h2h",
        status: "to_do",
        progress_percent: "0",
        total_working_hours: "",
        priority: "medium",
      };
}

type ProjectFormDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: Project;
};

export function ProjectFormDialog({ mode, open, onOpenChange, initialValue }: ProjectFormDialogProps) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState<FormState>(() => formFromProject(initialValue));
  const queryClient = useQueryClient();

  const mutation = useMutation<{ success: true }, Error, void>({
    mutationFn: () => {
      const payload = {
        name: form.name,
        item_type: form.item_type,
        start_date: form.start_date,
        end_date: form.end_date,
        product: form.product,
        status: form.status,
        progress_percent: Number(form.progress_percent),
        total_working_hours: Number(form.total_working_hours),
        priority: form.priority,
      };
      return isEdit && initialValue ? updateProject(initialValue.id, payload) : createProject(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Item updated" : "Item created");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (!isEdit) setForm(formFromProject());
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit item" : "New item"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="item_type">Item Type</Label>
            <Select value={form.item_type} onValueChange={(value) => setForm((f) => ({ ...f, item_type: value as ItemType }))}>
              <SelectTrigger id="item_type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="support_testing">Support Testing</SelectItem>
                <SelectItem value="problem_incident">Problem Incident</SelectItem>
                <SelectItem value="service_request">Service Request</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start Date</Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End Date</Label>
              <Input
                id="end_date"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="product">Product</Label>
              <Select value={form.product} onValueChange={(value) => setForm((f) => ({ ...f, product: value as Product }))}>
                <SelectTrigger id="product" className="w-full">
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
              <Label htmlFor="status">Status</Label>
              <Select value={form.status} onValueChange={(value) => setForm((f) => ({ ...f, status: value as ProjectStatus }))}>
                <SelectTrigger id="status" className="w-full">
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="total_working_hours">Total Working Hours</Label>
              <Input
                id="total_working_hours"
                type="number"
                min={1}
                step={1}
                value={form.total_working_hours}
                onChange={(e) => setForm((f) => ({ ...f, total_working_hours: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select value={form.priority} onValueChange={(value) => setForm((f) => ({ ...f, priority: value as Priority }))}>
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
          </div>

          {form.status !== "completed" && (
            <div className="space-y-2">
              <Label htmlFor="progress">Progress %</Label>
              <Input
                id="progress"
                type="number"
                min={0}
                max={100}
                step={1}
                value={form.progress_percent}
                onChange={(e) => setForm((f) => ({ ...f, progress_percent: e.target.value }))}
                required
              />
            </div>
          )}

          {isEdit && form.status === "completed" && (
            <p className="text-xs text-muted-foreground">
              Progress is locked at 100% once Completed, and every assignment on this item will be closed out
              (ongoing ones end today; not-yet-started ones are removed) when you save.
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : isEdit ? "Save" : "Create item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
