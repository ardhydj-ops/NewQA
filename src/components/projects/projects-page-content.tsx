"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImportScheduleDialog } from "@/components/projects/import-schedule-dialog";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectSummaryCards } from "@/components/projects/project-summary-cards";
import { ProjectTable, type ProjectSortKey } from "@/components/projects/project-table";
import { ProposeProjectDialog } from "@/components/projects/propose-project-dialog";
import { getApprovedAllocationCountsByProject } from "@/features/allocation-action";
import { getProducts } from "@/features/product-action";
import { getProjectById, getProjects } from "@/features/project-action";
import { getQaGroups } from "@/features/qa-group-action";
import type { ItemType, Priority, ProjectStatus } from "@/lib/project";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";

const PAGE_SIZE = 10;

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  project: "Project",
  support_testing: "Support Testing",
  problem_incident: "Problem Incident",
  service_request: "Service Request",
};

const ITEM_TYPE_ORDER: ItemType[] = ["project", "support_testing", "problem_incident", "service_request"];

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const PRIORITY_ORDER: Priority[] = ["low", "medium", "high", "critical"];

const STATUS_ORDER: ProjectStatus[] = ["to_do", "ready_sit", "sit", "ready_uat", "uat", "completed"];

export function ProjectsPageContent({
  role,
  currentProfileId,
  qaGroupId,
}: {
  role: ProfileRole;
  currentProfileId: string;
  qaGroupId: string | null;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [productFilter, setProductFilter] = useState("");
  const [qaGroupFilter, setQaGroupFilter] = useState(() => (role === "qa_lead" ? (qaGroupId ?? "") : ""));
  const [typeFilter, setTypeFilter] = useState<ItemType | "">("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
  const [sortKey, setSortKey] = useState<ProjectSortKey>("assigned");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [createOpen, setCreateOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sharedProjectId, setSharedProjectId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("project"),
  );
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  const router = useRouter();

  const {
    data: sharedProject,
    isFetched: sharedProjectFetched,
    isError: sharedProjectIsError,
  } = useQuery({
    queryKey: ["project", sharedProjectId],
    queryFn: () => getProjectById(sharedProjectId!),
    enabled: !!sharedProjectId,
  });

  useEffect(() => {
    if (!sharedProjectId || !sharedProjectFetched) return;

    /* eslint-disable react-hooks/set-state-in-effect -- one-time sync: land on the shared project (via search/filters) once its fetch resolves */
    if (sharedProjectIsError || !sharedProject) {
      toast.error("That shared project link could not be found");
    } else {
      setSearch(sharedProject.name);
      setStatusFilter("");
      setProductFilter("");
      setQaGroupFilter("");
      setTypeFilter("");
      setPriorityFilter("");
      setPage(1);
      setHighlightedProjectId(sharedProject.id);
    }
    setSharedProjectId(null);
    router.replace("/projects");
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedProjectId, sharedProjectFetched, sharedProjectIsError, sharedProject]);

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "projects",
      {
        search,
        status: statusFilter,
        product_id: productFilter,
        qa_group_id: qaGroupFilter,
        item_type: typeFilter,
        priority: priorityFilter,
      },
    ],
    queryFn: () =>
      getProjects({
        search,
        status: statusFilter,
        product_id: productFilter,
        qa_group_id: qaGroupFilter,
        item_type: typeFilter,
        priority: priorityFilter,
      }),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));
  const productQaGroupId = new Map((products ?? []).map((p) => [p.id, p.qa_group_id]));

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });
  const qaGroupNameById = new Map((qaGroups ?? []).map((g) => [g.id, g.name]));

  const { data: assignmentCounts } = useQuery({
    queryKey: ["allocation-counts", "approved"],
    queryFn: () => getApprovedAllocationCountsByProject(),
  });

  const allRows = data ?? [];

  function handleSortChange(key: ProjectSortKey) {
    if (key === sortKey) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
    setPage(1);
  }

  const sortedRows = [...allRows].sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":
        return a.name.localeCompare(b.name) * direction;
      case "assigned":
        return ((assignmentCounts?.[a.id] ?? 0) - (assignmentCounts?.[b.id] ?? 0)) * direction;
      case "product": {
        const namesA = a.product_ids.map((id) => productNameById.get(id) ?? "").sort().join(", ");
        const namesB = b.product_ids.map((id) => productNameById.get(id) ?? "").sort().join(", ");
        return namesA.localeCompare(namesB) * direction;
      }
      case "progress":
        return (a.progress_percent - b.progress_percent) * direction;
      case "start_date":
        return a.start_date.localeCompare(b.start_date) * direction;
      case "end_date":
        if (!a.end_date && !b.end_date) return 0;
        if (!a.end_date) return 1;
        if (!b.end_date) return -1;
        return a.end_date.localeCompare(b.end_date) * direction;
      case "total_days":
        return (a.total_working_days - b.total_working_days) * direction;
      case "type":
        return (ITEM_TYPE_ORDER.indexOf(a.item_type) - ITEM_TYPE_ORDER.indexOf(b.item_type)) * direction;
      case "status":
        return (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * direction;
      case "priority":
        return (PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)) * direction;
      default:
        return 0;
    }
  });

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Project Portfolio</h1>
          <p className="text-sm text-muted-foreground">
            Manage and track projects, support testing, problem incidents, and service requests.
          </p>
        </div>
        {QA_LEAD_ROLES.includes(role) && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Item
          </Button>
        )}
        {role === "project_manager" && (
          <Button onClick={() => setProposeOpen(true)}>
            <Plus className="size-4" />
            Propose Item
          </Button>
        )}
        {(QA_LEAD_ROLES.includes(role) || role === "project_manager") && (
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            Import Schedule
          </Button>
        )}
      </div>

      <ProjectSummaryCards
        rows={allRows}
        assignmentCounts={assignmentCounts ?? {}}
        productNameById={productNameById}
        productQaGroupId={productQaGroupId}
        qaGroupNameById={qaGroupNameById}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
            setHighlightedProjectId(null);
          }}
          placeholder="Search..."
          className="max-w-64"
        />
        <Select
          value={statusFilter || "all"}
          onValueChange={(v) => {
            setStatusFilter(v === "all" ? "" : (v as ProjectStatus));
            setPage(1);
            setHighlightedProjectId(null);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="to_do">To Do</SelectItem>
            <SelectItem value="ready_sit">Ready to SIT</SelectItem>
            <SelectItem value="sit">SIT</SelectItem>
            <SelectItem value="ready_uat">Ready to UAT</SelectItem>
            <SelectItem value="uat">UAT</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={productFilter || "all"}
          onValueChange={(v) => {
            setProductFilter(v === "all" ? "" : v);
            setPage(1);
            setHighlightedProjectId(null);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {(products ?? []).map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={qaGroupFilter || "all"}
          onValueChange={(v) => {
            setQaGroupFilter(v === "all" ? "" : v);
            setPage(1);
            setHighlightedProjectId(null);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="QA Group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All QA Groups</SelectItem>
            {(qaGroups ?? []).map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={typeFilter || "all"}
          onValueChange={(v) => {
            setTypeFilter(v === "all" ? "" : (v as ItemType));
            setPage(1);
            setHighlightedProjectId(null);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {(Object.entries(ITEM_TYPE_LABEL) as [ItemType, string][]).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={priorityFilter || "all"}
          onValueChange={(v) => {
            setPriorityFilter(v === "all" ? "" : (v as Priority));
            setPage(1);
            setHighlightedProjectId(null);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {(Object.entries(PRIORITY_LABEL) as [Priority, string][]).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ProjectTable
        rows={pagedRows}
        isLoading={isLoading}
        isError={isError}
        role={role}
        currentProfileId={currentProfileId}
        productNameById={productNameById}
        assignmentCounts={assignmentCounts ?? {}}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        highlightedProjectId={highlightedProjectId}
      />

      {!isLoading && sortedRows.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sortedRows.length)} of{" "}
            {sortedRows.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {QA_LEAD_ROLES.includes(role) && <ProjectFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />}
      {role === "project_manager" && <ProposeProjectDialog open={proposeOpen} onOpenChange={setProposeOpen} />}
      <ImportScheduleDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
