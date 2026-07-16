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
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/components/i18n/language-provider";
import {
  createTestingTask,
  updateTestingTask,
} from "@/features/testing-task-action";
import type {
  TestingTask,
  TestingTaskPriority,
  TestingTaskStatus,
} from "@/lib/testing-task";

type FormState = {
  title: string;
  description: string;
  status: TestingTaskStatus;
  priority: TestingTaskPriority;
  start_date: string;
  due_date: string;
  total_tc: string;
  ok_count: string;
  nok_count: string;
  na_count: string;
  total_execute_tc: string;
  total_passed_tc: string;
};

type SubmitPayload = {
  title: string;
  description?: string;
  status: TestingTaskStatus;
  priority: TestingTaskPriority;
  start_date: string;
  due_date?: string;
  total_tc: number;
  ok_count: number;
  nok_count: number;
  na_count: number;
  total_execute_tc: number;
  total_passed_tc: number;
};

type TestingTaskFormDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wajib diisi saat mode "edit" — dipakai untuk pre-fill + target update. */
  initialValue?: TestingTask;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formFromTask(task?: TestingTask): FormState {
  return task
    ? {
        title: task.title,
        description: task.description ?? "",
        status: task.status,
        priority: task.priority,
        start_date: task.start_date,
        due_date: task.due_date ?? "",
        total_tc: String(task.total_tc),
        ok_count: String(task.ok_count),
        nok_count: String(task.nok_count),
        na_count: String(task.na_count),
        total_execute_tc: String(task.total_execute_tc),
        total_passed_tc: String(task.total_passed_tc),
      }
    : {
        title: "",
        description: "",
        status: "not_started",
        priority: "medium",
        start_date: todayISO(),
        due_date: "",
        total_tc: "0",
        ok_count: "0",
        nok_count: "0",
        na_count: "0",
        total_execute_tc: "0",
        total_passed_tc: "0",
      };
}

export function TestingTaskFormDialog({
  mode,
  open,
  onOpenChange,
  initialValue,
}: TestingTaskFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = mode === "edit";

  const [form, setForm] = useState<FormState>(() => formFromTask(initialValue));

  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: SubmitPayload) =>
      isEdit && initialValue
        ? updateTestingTask(initialValue.id, payload)
        : createTestingTask(payload),
    onSuccess: () => {
      toast.success(
        isEdit ? t("taskForm.toast.updated") : t("taskForm.toast.created"),
      );
      queryClient.invalidateQueries({ queryKey: ["testing-tasks"] });
      if (!isEdit) setForm(formFromTask());
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    mutation.mutate({
      title: form.title,
      description: form.description.trim() || undefined,
      status: form.status,
      priority: form.priority,
      start_date: form.start_date,
      due_date: form.due_date.trim() || undefined,
      total_tc: Number(form.total_tc),
      ok_count: Number(form.ok_count),
      nok_count: Number(form.nok_count),
      na_count: Number(form.na_count),
      total_execute_tc: Number(form.total_execute_tc),
      total_passed_tc: Number(form.total_passed_tc),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("taskForm.edit.title") : t("taskForm.create.title")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t("taskForm.edit.desc") : t("taskForm.create.desc")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">{t("taskForm.label.title")}</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t("taskForm.placeholder.title")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t("taskForm.label.description")}</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder={t("taskForm.placeholder.description")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="status">{t("taskForm.label.status")}</Label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, status: value as TestingTaskStatus }))
                }
              >
                <SelectTrigger id="status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">
                    {t("testingTasks.status.notStarted")}
                  </SelectItem>
                  <SelectItem value="in_progress">
                    {t("testingTasks.status.inProgress")}
                  </SelectItem>
                  <SelectItem value="passed">
                    {t("testingTasks.status.passed")}
                  </SelectItem>
                  <SelectItem value="failed">
                    {t("testingTasks.status.failed")}
                  </SelectItem>
                  <SelectItem value="blocked">
                    {t("testingTasks.status.blocked")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">{t("taskForm.label.priority")}</Label>
              <Select
                value={form.priority}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, priority: value as TestingTaskPriority }))
                }
              >
                <SelectTrigger id="priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t("testingTasks.priority.low")}</SelectItem>
                  <SelectItem value="medium">
                    {t("testingTasks.priority.medium")}
                  </SelectItem>
                  <SelectItem value="high">{t("testingTasks.priority.high")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_date">{t("taskForm.label.startDate")}</Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, start_date: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="due_date">{t("taskForm.label.dueDate")}</Label>
              <Input
                id="due_date"
                type="date"
                value={form.due_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, due_date: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label className="text-sm font-medium text-muted-foreground">
              {t("taskForm.section.metrics")}
            </Label>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="total_tc">{t("taskForm.label.totalTc")}</Label>
                <Input
                  id="total_tc"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.total_tc}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, total_tc: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ok_count">{t("taskForm.label.okCount")}</Label>
                <Input
                  id="ok_count"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.ok_count}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ok_count: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nok_count">{t("taskForm.label.nokCount")}</Label>
                <Input
                  id="nok_count"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.nok_count}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nok_count: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="na_count">{t("taskForm.label.naCount")}</Label>
                <Input
                  id="na_count"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.na_count}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, na_count: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_execute_tc">
                  {t("taskForm.label.totalExecuteTc")}
                </Label>
                <Input
                  id="total_execute_tc"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.total_execute_tc}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, total_execute_tc: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_passed_tc">
                  {t("taskForm.label.totalPassedTc")}
                </Label>
                <Input
                  id="total_passed_tc"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.total_passed_tc}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, total_passed_tc: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? isEdit
                  ? t("taskForm.submit.saving")
                  : t("taskForm.submit.adding")
                : isEdit
                  ? t("taskForm.submit.save")
                  : t("taskForm.submit.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
