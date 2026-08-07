"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Undo2 } from "lucide-react";
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
import { AllocationEditDialog } from "@/components/allocations/allocation-edit-dialog";
import {
  deleteAllocation,
  getAllocationsForUser,
  withdrawAllocationProposal,
} from "@/features/allocation-action";
import { formatDate } from "@/lib/format";
import type { Allocation } from "@/lib/allocation";
import type { Project } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

type AssignmentsTableProps = {
  userId: string;
  userName: string;
  projects: Project[];
  role: ProfileRole;
  currentProfileId: string;
};

export function AssignmentsTable({ userId, userName, projects, role, currentProfileId }: AssignmentsTableProps) {
  const [editingAllocation, setEditingAllocation] = useState<Allocation | null>(null);
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
    .reduce((sum, a) => sum + a.hours_per_week, 0);

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
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Hours/Wk</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
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
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{allocation.role_on_project}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{allocation.hours_per_week}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(allocation.start_date)} –{" "}
                    {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {role === "qa_lead" && allocation.approval_status === "approved" && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setEditingAllocation(allocation)}
                          aria-label="Edit assignment"
                        >
                          <Pencil className="size-4" />
                        </Button>
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
                      </div>
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
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="pl-6">Total Allocated</TableCell>
                <TableCell className="text-right tabular-nums">{totalAllocated} hrs</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </CardContent>

      {editingAllocation && (
        <AllocationEditDialog
          key={editingAllocation.id}
          allocation={editingAllocation}
          open
          onOpenChange={(o) => {
            if (!o) setEditingAllocation(null);
          }}
        />
      )}
    </Card>
  );
}
