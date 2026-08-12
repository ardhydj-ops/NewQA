"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAllocationsForProject } from "@/features/allocation-action";
import { getProfiles } from "@/features/profile-action";
import { formatDate } from "@/lib/format";
import type { Priority, Project } from "@/lib/project";

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

type ProjectAssignmentsDialogProps = {
  project: Project;
  productNameById: Map<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectAssignmentsDialog({
  project,
  productNameById,
  open,
  onOpenChange,
}: ProjectAssignmentsDialogProps) {
  const { data: allocations, isLoading } = useQuery({
    queryKey: ["allocations", "project", project.id],
    queryFn: () => getAllocationsForProject(project.id),
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => getProfiles(),
  });
  const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assigned QAs — {project.name}</DialogTitle>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>QA</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Days/Wk</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : !allocations || allocations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No QAs assigned to this item yet.
                </TableCell>
              </TableRow>
            ) : (
              allocations.map((allocation) => (
                <TableRow key={allocation.id}>
                  <TableCell className="text-sm font-medium">
                    {profileNameById.get(allocation.user_id) ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {productNameById.get(allocation.product_id) ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{allocation.role_on_project}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {Math.round(allocation.days_per_week * 2) / 2}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{PRIORITY_LABEL[allocation.priority]}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(allocation.start_date)} –{" "}
                    {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                  </TableCell>
                  <TableCell>
                    {allocation.approval_status === "approved" && (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        Approved
                      </Badge>
                    )}
                    {allocation.approval_status === "pending" && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        Pending
                      </Badge>
                    )}
                    {allocation.approval_status === "rejected" && (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                        Rejected
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
