"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RebaselineDialog } from "@/components/allocations/rebaseline-dialog";
import {
  deleteAllocation,
  getAllocationsForUser,
  withdrawAllocationProposal,
} from "@/features/allocation-action";
import { hasPendingChange, type Allocation } from "@/lib/allocation";
import { formatDate } from "@/lib/format";
import type { Priority, Project } from "@/lib/project";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";

const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

type AssignmentsTableProps = {
  userId: string;
  userName: string;
  projects: Project[];
  productNameById: Map<string, string>;
  role: ProfileRole;
  currentProfileId: string;
};

export function AssignmentsTable({
  userId,
  userName,
  projects,
  productNameById,
  role,
  currentProfileId,
}: AssignmentsTableProps) {
  const [rebaseliningAllocation, setRebaseliningAllocation] = useState<Allocation | null>(null);
  const queryClient = useQueryClient();
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const { data, isLoading } = useQuery({
    queryKey: ["allocations", "user", userId],
    queryFn: () => getAllocationsForUser(userId),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAllocation,
    onSuccess: () => {
      toast.success("Assignment removed");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["projects-for-month"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const withdrawMutation = useMutation({
    mutationFn: withdrawAllocationProposal,
    onSuccess: () => {
      toast.success("Proposal withdrawn");
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = data ?? [];
  const totalAllocated = rows
    .filter((a) => a.approval_status === "approved")
    .reduce((sum, a) => sum + a.days_per_week, 0);

  const canRebaseline = QA_LEAD_ROLES.includes(role) || role === "project_manager";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Assignments: {userName}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Project Name</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Days/Wk</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No assignments yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((allocation) => (
                <TableRow key={allocation.id}>
                  <TableCell className="pl-6 text-sm font-medium">
                    {projectNameById.get(allocation.project_id) ?? "—"}
                    {allocation.approval_status === "pending" && (
                      <Badge variant="outline" className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                        Pending
                      </Badge>
                    )}
                    {allocation.approval_status === "rejected" && (
                      <Badge variant="outline" className="ml-2 border-rose-200 bg-rose-50 text-rose-700">
                        Rejected
                      </Badge>
                    )}
                    {allocation.approval_status === "approved" && hasPendingChange(allocation) && (
                      <Badge variant="outline" className="ml-2 border-blue-200 bg-blue-50 text-blue-700">
                        Pending Change
                      </Badge>
                    )}
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
                  <TableCell className="pr-6 text-right">
                    <div className="flex justify-end gap-1">
                      {canRebaseline && allocation.approval_status === "approved" && !hasPendingChange(allocation) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setRebaseliningAllocation(allocation)}
                          aria-label="Rebaseline assignment"
                        >
                          <GitBranch className="size-4" />
                        </Button>
                      )}
                      {QA_LEAD_ROLES.includes(role) && allocation.approval_status === "approved" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(allocation.id)}
                          aria-label="Delete assignment"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                      {role === "project_manager" &&
                        allocation.approval_status === "pending" &&
                        allocation.proposed_by === currentProfileId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={withdrawMutation.isPending}
                            onClick={() => withdrawMutation.mutate(allocation.id)}
                          >
                            <Undo2 className="size-4" />
                            Withdraw
                          </Button>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="pl-6">Total Allocated</TableCell>
                <TableCell className="text-right tabular-nums">{Math.round(totalAllocated * 2) / 2} days</TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>

      {rebaseliningAllocation && (
        <RebaselineDialog
          key={rebaseliningAllocation.id}
          allocation={rebaseliningAllocation}
          role={role}
          open
          onOpenChange={(o) => {
            if (!o) setRebaseliningAllocation(null);
          }}
        />
      )}
    </Card>
  );
}
