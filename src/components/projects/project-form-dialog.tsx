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
import type { Product, Project, ProjectStatus } from "@/lib/project";

type FormState = {
  name: string;
  start_date: string;
  end_date: string;
  product: Product;
  status: ProjectStatus;
  progress_percent: string;
};

function formFromProject(project?: Project): FormState {
  return project
    ? {
        name: project.name,
        start_date: project.start_date,
        end_date: project.end_date ?? "",
        product: project.product,
        status: project.status,
        progress_percent: String(project.progress_percent),
      }
    : {
        name: "",
        start_date: "",
        end_date: "",
        product: "qris_h2h",
        status: "to_do",
        progress_percent: "0",
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
        start_date: form.start_date,
        end_date: form.end_date || undefined,
        product: form.product,
        status: form.status,
        progress_percent: Number(form.progress_percent),
      };
      return isEdit && initialValue ? updateProject(initialValue.id, payload) : createProject(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Project updated" : "Project created");
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
          <DialogTitle>{isEdit ? "Edit project" : "New project"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Project Name</Label>
            <Input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
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

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : isEdit ? "Save" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
