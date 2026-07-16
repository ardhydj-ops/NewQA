"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/components/i18n/language-provider";
import { PaginationControls } from "@/components/transactions/pagination-controls";
import { SearchInput } from "@/components/transactions/search-input";
import { TestingTaskFormDialog } from "@/components/testing-tasks/testing-task-form-dialog";
import { TestingTaskTable } from "@/components/testing-tasks/testing-task-table";
import { getTestingTasks } from "@/features/testing-task-action";
import type { TestingTaskPriority, TestingTaskStatus } from "@/lib/testing-task";

const LIMIT = 10;

export default function TestingTasksPage() {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TestingTaskStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TestingTaskPriority | "">("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "testing-tasks",
      { page, limit: LIMIT, search, status: statusFilter, priority: priorityFilter },
    ],
    queryFn: () =>
      getTestingTasks({
        page,
        limit: LIMIT,
        search,
        status: statusFilter,
        priority: priorityFilter,
      }),
  });

  const rows = data?.rows ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / LIMIT));

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handleStatusFilter(value: string) {
    setStatusFilter(value === "all" ? "" : (value as TestingTaskStatus));
    setPage(1);
  }

  function handlePriorityFilter(value: string) {
    setPriorityFilter(value === "all" ? "" : (value as TestingTaskPriority));
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("testingTasks.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("testingTasks.subtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          {t("testingTasks.add")}
        </Button>
        <TestingTaskFormDialog
          mode="create"
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-64 flex-1">
          <SearchInput
            onSearch={handleSearch}
            placeholder={t("testingTasks.searchPlaceholder")}
          />
        </div>

        <Select value={statusFilter || "all"} onValueChange={handleStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t("testingTasks.filter.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("testingTasks.filter.allStatus")}</SelectItem>
            <SelectItem value="not_started">
              {t("testingTasks.status.notStarted")}
            </SelectItem>
            <SelectItem value="in_progress">
              {t("testingTasks.status.inProgress")}
            </SelectItem>
            <SelectItem value="passed">{t("testingTasks.status.passed")}</SelectItem>
            <SelectItem value="failed">{t("testingTasks.status.failed")}</SelectItem>
            <SelectItem value="blocked">{t("testingTasks.status.blocked")}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={priorityFilter || "all"} onValueChange={handlePriorityFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("testingTasks.filter.priority")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("testingTasks.filter.allPriority")}</SelectItem>
            <SelectItem value="low">{t("testingTasks.priority.low")}</SelectItem>
            <SelectItem value="medium">{t("testingTasks.priority.medium")}</SelectItem>
            <SelectItem value="high">{t("testingTasks.priority.high")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <TestingTaskTable rows={rows} isLoading={isLoading} isError={isError} />

      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
    </div>
  );
}
