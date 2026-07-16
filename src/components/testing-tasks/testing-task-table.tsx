"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TestingTaskFormDialog } from "@/components/testing-tasks/testing-task-form-dialog";
import { useTranslation } from "@/components/i18n/language-provider";
import { deleteTestingTask } from "@/features/testing-task-action";
import { computeTcPercentages } from "@/lib/testing-task-metrics";
import { formatDate } from "@/lib/format";
import type { TestingTask, TestingTaskPriority, TestingTaskStatus } from "@/lib/testing-task";
import type { TranslationKey } from "@/i18n/translations";

type TestingTaskTableProps = {
  rows: TestingTask[];
  isLoading: boolean;
  isError: boolean;
};

const STATUS_BADGE_CLASS: Record<TestingTaskStatus, string> = {
  not_started:
    "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-300",
  in_progress:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",
  passed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
  blocked:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
};

const STATUS_LABEL_KEY: Record<TestingTaskStatus, TranslationKey> = {
  not_started: "testingTasks.status.notStarted",
  in_progress: "testingTasks.status.inProgress",
  passed: "testingTasks.status.passed",
  failed: "testingTasks.status.failed",
  blocked: "testingTasks.status.blocked",
};

const PRIORITY_LABEL_KEY: Record<TestingTaskPriority, TranslationKey> = {
  low: "testingTasks.priority.low",
  medium: "testingTasks.priority.medium",
  high: "testingTasks.priority.high",
};

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function TestingTaskTable({
  rows,
  isLoading,
  isError,
}: TestingTaskTableProps) {
  const { t } = useTranslation();
  const [editingTask, setEditingTask] = useState<TestingTask | null>(null);
  const [deletingTask, setDeletingTask] = useState<TestingTask | null>(null);

  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: deleteTestingTask,
    onSuccess: () => {
      toast.success(t("taskDelete.toast"));
      queryClient.invalidateQueries({ queryKey: ["testing-tasks"] });
      setDeletingTask(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("testingTasks.cardTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">{t("testingTasks.col.title")}</TableHead>
              <TableHead>{t("testingTasks.col.status")}</TableHead>
              <TableHead>{t("testingTasks.col.priority")}</TableHead>
              <TableHead>{t("testingTasks.col.startDate")}</TableHead>
              <TableHead>{t("testingTasks.col.dueDate")}</TableHead>
              <TableHead className="text-right">
                {t("testingTasks.col.percentExecute")}
              </TableHead>
              <TableHead className="text-right">
                {t("testingTasks.col.percentPassed")}
              </TableHead>
              <TableHead className="pr-6 text-right">
                {t("testingTasks.col.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6">
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-12" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-12" />
                  </TableCell>
                  <TableCell className="pr-6">
                    <Skeleton className="ml-auto size-8 rounded-md" />
                  </TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {t("testingTasks.loadError")}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {t("testingTasks.empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((task) => {
                const { percentExecuted, percentPassed } = computeTcPercentages(task);
                return (
                  <TableRow key={task.id}>
                    <TableCell className="pl-6 text-sm font-medium">
                      {task.title}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_BADGE_CLASS[task.status]}
                      >
                        {t(STATUS_LABEL_KEY[task.status])}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {t(PRIORITY_LABEL_KEY[task.priority])}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(task.start_date)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {task.due_date ? formatDate(task.due_date) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatPercent(percentExecuted)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatPercent(percentPassed)}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t("testingTasks.action.aria")}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditingTask(task)}>
                            <Pencil className="size-4" />
                            {t("testingTasks.action.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setDeletingTask(task)}
                            className="text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-400"
                          >
                            <Trash2 className="size-4" />
                            {t("testingTasks.action.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      {editingTask && (
        <TestingTaskFormDialog
          key={editingTask.id}
          mode="edit"
          open
          onOpenChange={(o) => {
            if (!o) setEditingTask(null);
          }}
          initialValue={editingTask}
        />
      )}

      <AlertDialog
        open={deletingTask !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingTask(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("taskDelete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("taskDelete.desc", { name: deletingTask?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("taskDelete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingTask) deleteMutation.mutate(deletingTask.id);
              }}
            >
              {deleteMutation.isPending
                ? t("taskDelete.deleting")
                : t("taskDelete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
