"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserPlus,
  Undo2,
} from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BulkAssignDialog } from "@/components/allocations/bulk-assign-dialog";
import { ProjectAssignmentsDialog } from "@/components/projects/project-assignments-dialog";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectRebaselineDialog } from "@/components/projects/project-rebaseline-dialog";
import { deleteProject, withdrawProjectProposal } from "@/features/project-action";
import { formatDate } from "@/lib/format";
import type { ItemType, Priority, Project, ProjectStatus } from "@/lib/project";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  to_do: "To Do",
  ready_sit: "Ready to SIT",
  sit: "SIT",
  ready_uat: "Ready to UAT",
  uat: "UAT",
  completed: "Completed",
};

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  project: "Project",
  support_testing: "Support Testing",
  problem_incident: "Problem Incident",
  service_request: "Service Request",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const PRIORITY_BADGE_CLASS: Record<Priority, string> = {
  low: "border-slate-200 bg-slate-50 text-slate-700",
  medium: "border-blue-200 bg-blue-50 text-blue-700",
  high: "border-amber-200 bg-amber-50 text-amber-700",
  critical: "border-rose-200 bg-rose-50 text-rose-700",
};

export type ProjectSortKey =
  | "name"
  | "assigned"
  | "product"
  | "progress"
  | "start_date"
  | "end_date"
  | "total_days"
  | "type"
  | "status"
  | "priority";

type SortableHeaderProps = {
  label: string;
  sortKey: ProjectSortKey;
  activeKey: ProjectSortKey;
  direction: "asc" | "desc";
  onSort: (key: ProjectSortKey) => void;
  className?: string;
};

function SortableHeader({ label, sortKey, activeKey, direction, onSort, className }: SortableHeaderProps) {
  const isActive = sortKey === activeKey;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {isActive ? (
          direction === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 text-muted-foreground/50" />
        )}
      </button>
    </TableHead>
  );
}

type ProjectTableProps = {
  rows: Project[];
  isLoading: boolean;
  isError: boolean;
  role: ProfileRole;
  currentProfileId: string;
  productNameById: Map<string, string>;
  assignmentCounts: Record<string, number>;
  sortKey: ProjectSortKey;
  sortDirection: "asc" | "desc";
  onSortChange: (key: ProjectSortKey) => void;
};

export function ProjectTable({
  rows,
  isLoading,
  isError,
  role,
  currentProfileId,
  productNameById,
  assignmentCounts,
  sortKey,
  sortDirection,
  onSortChange,
}: ProjectTableProps) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [viewingProject, setViewingProject] = useState<Project | null>(null);
  const [assigningProject, setAssigningProject] = useState<Project | null>(null);
  const [rebaseliningProject, setRebaseliningProject] = useState<Project | null>(null);
  const queryClient = useQueryClient();

  const canEdit = QA_LEAD_ROLES.includes(role);
  const canPropose = role === "project_manager";
  const showActions = canEdit || canPropose;
  const columnCount = showActions ? 11 : 10;

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      toast.success("Item deleted");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDeletingProject(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const withdrawMutation = useMutation({
    mutationFn: withdrawProjectProposal,
    onSuccess: () => {
      toast.success("Proposal withdrawn");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                label="Name"
                sortKey="name"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSortChange}
                className="w-50 pl-6"
              />
              <SortableHeader label="Assigned" sortKey="assigned" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
              <SortableHeader label="Products" sortKey="product" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
              <SortableHeader label="Progress" sortKey="progress" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
              <SortableHeader label="Start Date" sortKey="start_date" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
              <SortableHeader label="End Date" sortKey="end_date" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
              <SortableHeader
                label="Total Days"
                sortKey="total_days"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSortChange}
                className="text-right"
              />
              <SortableHeader label="Type" sortKey="type" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
              <SortableHeader label="Status" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
              <SortableHeader label="Priority" sortKey="priority" activeKey={sortKey} direction={sortDirection} onSort={onSortChange} />
              <TableHead>Link</TableHead>
              {showActions && <TableHead className="pr-6 text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6"><Skeleton className="h-4 w-50" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                  {showActions && <TableCell className="pr-6"><Skeleton className="ml-auto size-8 rounded-md" /></TableCell>}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  Failed to load items.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  No items yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((project) => {
                const needsAttention = (assignmentCounts[project.id] ?? 0) === 0 && project.progress_percent === 0;
                return (
                <TableRow key={project.id} className={needsAttention ? "bg-red-50" : undefined}>
                  <TableCell className="w-50 pl-6 text-sm font-medium whitespace-normal break-words">
                    {project.name}
                    {project.approval_status === "pending" && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                        Pending Approval
                      </Badge>
                    )}
                    {project.approval_status === "rejected" && (
                      <Badge variant="outline" className="ml-2 border-rose-200 bg-rose-50 text-rose-700">
                        Rejected
                      </Badge>
                    )}
                    {project.proposed_start_date !== null && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                        Rebaseline Pending
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-sm font-normal"
                      onClick={() => setViewingProject(project)}
                    >
                      {assignmentCounts[project.id] ?? 0} QA{(assignmentCounts[project.id] ?? 0) === 1 ? "" : "s"}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{productNameById.get(project.product_id) ?? "—"}</Badge>
                  </TableCell>
                  <TableCell>
                    <ProgressBar percent={project.progress_percent} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(project.start_date)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {project.end_date ? formatDate(project.end_date) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{project.total_working_days}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{ITEM_TYPE_LABEL[project.item_type]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{STATUS_LABEL[project.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={PRIORITY_BADGE_CLASS[project.priority]}>
                      {PRIORITY_LABEL[project.priority]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {project.jira_link && (
                        <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-xs" asChild>
                          <a href={project.jira_link} target="_blank" rel="noopener noreferrer">
                            JIRA <ExternalLink className="size-3" />
                          </a>
                        </Button>
                      )}
                      {project.jiva_link && (
                        <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-xs" asChild>
                          <a href={project.jiva_link} target="_blank" rel="noopener noreferrer">
                            Jiva <ExternalLink className="size-3" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  {showActions && (
                    <TableCell className="pr-6 text-right">
                      <div className="flex justify-end gap-1">
                        {(canEdit || canPropose) && project.approval_status === "approved" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => setAssigningProject(project)}
                            aria-label="Assign QA"
                          >
                            <UserPlus className="size-4" />
                          </Button>
                        )}
                        {canPropose && project.approval_status === "approved" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => setRebaseliningProject(project)}
                            aria-label="Rebaseline"
                          >
                            <CalendarClock className="size-4" />
                          </Button>
                        )}
                        {canEdit && project.approval_status === "approved" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setEditingProject(project)}>
                                <Pencil className="size-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setDeletingProject(project)}
                                className="text-rose-600 focus:text-rose-600"
                              >
                                <Trash2 className="size-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {canPropose && project.approval_status === "pending" && project.proposed_by === currentProfileId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={withdrawMutation.isPending}
                            onClick={() => withdrawMutation.mutate(project.id)}
                          >
                            <Undo2 className="size-4" />
                            Withdraw
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      {assigningProject && (
        <BulkAssignDialog
          key={assigningProject.id}
          role={role}
          presetProject={assigningProject}
          open
          onOpenChange={(o) => {
            if (!o) setAssigningProject(null);
          }}
        />
      )}

      {rebaseliningProject && (
        <ProjectRebaselineDialog
          key={rebaseliningProject.id}
          project={rebaseliningProject}
          open
          onOpenChange={(o) => {
            if (!o) setRebaseliningProject(null);
          }}
        />
      )}

      {editingProject && (
        <ProjectFormDialog
          key={editingProject.id}
          mode="edit"
          open
          onOpenChange={(o) => {
            if (!o) setEditingProject(null);
          }}
          initialValue={editingProject}
        />
      )}

      {viewingProject && (
        <ProjectAssignmentsDialog
          key={viewingProject.id}
          project={viewingProject}
          open
          onOpenChange={(o) => {
            if (!o) setViewingProject(null);
          }}
        />
      )}

      <AlertDialog
        open={deletingProject !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingProject(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes &ldquo;{deletingProject?.name}&rdquo; and all of its allocations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingProject) deleteMutation.mutate(deletingProject.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
