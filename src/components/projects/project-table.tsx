"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Trash2, Undo2 } from "lucide-react";
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
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { deleteProject, withdrawProjectProposal } from "@/features/project-action";
import { formatDate } from "@/lib/format";
import type { ItemType, Priority, Product, Project, ProjectStatus } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

const PRODUCT_LABEL: Record<Product, string> = {
  qris_h2h: "QRIS H2H",
  qris_bo: "QRIS BO",
  qrcb: "QRCB",
  pi: "PI",
  jv: "JV",
  ccw: "CCW",
};

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

type ProjectTableProps = {
  rows: Project[];
  isLoading: boolean;
  isError: boolean;
  role: ProfileRole;
  currentProfileId: string;
};

export function ProjectTable({ rows, isLoading, isError, role, currentProfileId }: ProjectTableProps) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const queryClient = useQueryClient();

  const canEdit = role === "qa_lead";
  const canPropose = role === "project_manager";
  const showActions = canEdit || canPropose;
  const columnCount = showActions ? 9 : 8;

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
              <TableHead className="pl-6">Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>End Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="text-right">Total Hrs</TableHead>
              <TableHead>Progress</TableHead>
              {showActions && <TableHead className="pr-6 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
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
              rows.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="pl-6 text-sm font-medium">
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
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{ITEM_TYPE_LABEL[project.item_type]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{PRODUCT_LABEL[project.product]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(project.start_date)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {project.end_date ? formatDate(project.end_date) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{STATUS_LABEL[project.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={PRIORITY_BADGE_CLASS[project.priority]}>
                      {PRIORITY_LABEL[project.priority]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{project.total_working_hours}</TableCell>
                  <TableCell>
                    <ProgressBar percent={project.progress_percent} />
                  </TableCell>
                  {showActions && (
                    <TableCell className="pr-6 text-right">
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
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

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
