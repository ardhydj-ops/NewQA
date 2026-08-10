"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  approveAllocation,
  approveAllocationChange,
  approveProjectProposal,
  getPendingAllocationChanges,
  getPendingAllocationProposals,
  getPendingProjectProposals,
  rejectAllocation,
  rejectAllocationChange,
  rejectProjectProposal,
} from "@/features/approval-action";
import { getProjects } from "@/features/project-action";
import { formatDate } from "@/lib/format";

export function ApprovalsPageContent() {
  const queryClient = useQueryClient();

  const { data: proposals, isLoading: proposalsLoading } = useQuery({
    queryKey: ["approvals", "projects"],
    queryFn: () => getPendingProjectProposals(),
  });

  const { data: allocationProposals, isLoading: allocationsLoading } = useQuery({
    queryKey: ["approvals", "allocations"],
    queryFn: () => getPendingAllocationProposals(),
  });

  const { data: allocationChanges, isLoading: changesLoading } = useQuery({
    queryKey: ["approvals", "allocation-changes"],
    queryFn: () => getPendingAllocationChanges(),
  });

  const { data: approvedProjects } = useQuery({
    queryKey: ["projects", { approvalStatus: "approved" }],
    queryFn: () => getProjects({ approvalStatus: "approved" }),
  });
  const projectNameById = new Map((approvedProjects ?? []).map((p) => [p.id, p.name]));

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["allocations"] });
  }

  const approveProjectMutation = useMutation({
    mutationFn: approveProjectProposal,
    onSuccess: () => {
      toast.success("Project approved");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectProjectMutation = useMutation({
    mutationFn: rejectProjectProposal,
    onSuccess: () => {
      toast.success("Project rejected");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveAllocationMutation = useMutation({
    mutationFn: approveAllocation,
    onSuccess: () => {
      toast.success("Assignment approved");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectAllocationMutation = useMutation({
    mutationFn: rejectAllocation,
    onSuccess: () => {
      toast.success("Assignment rejected");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveChangeMutation = useMutation({
    mutationFn: approveAllocationChange,
    onSuccess: () => {
      toast.success("Rebaseline applied");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectChangeMutation = useMutation({
    mutationFn: rejectAllocationChange,
    onSuccess: () => {
      toast.success("Rebaseline rejected");
      invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Review project proposals, future assignments, and rebaseline requests submitted by Project Managers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Proposals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {proposalsLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !proposals || proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending project proposals.</p>
          ) : (
            proposals.map((proposal) => (
              <div key={proposal.id} className="rounded-md border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{proposal.name}</span>
                      <Badge variant="secondary">{proposal.product}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(proposal.start_date)} – {proposal.end_date ? formatDate(proposal.end_date) : "Ongoing"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rejectProjectMutation.isPending}
                      onClick={() => rejectProjectMutation.mutate(proposal.id)}
                    >
                      <X className="size-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={approveProjectMutation.isPending}
                      onClick={() => approveProjectMutation.mutate(proposal.id)}
                    >
                      <Check className="size-4" />
                      Approve
                    </Button>
                  </div>
                </div>

                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Hours/Wk</TableHead>
                      <TableHead>Timeline</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proposal.allocations.map((allocation) => (
                      <TableRow key={allocation.id}>
                        <TableCell>{allocation.role_on_project}</TableCell>
                        <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
                        <TableCell>
                          {formatDate(allocation.start_date)} –{" "}
                          {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Future Assignment Proposals</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Project</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Hours/Wk</TableHead>
                <TableHead>Timeline</TableHead>
                <TableHead className="pr-6 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocationsLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !allocationProposals || allocationProposals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No pending assignment proposals.
                  </TableCell>
                </TableRow>
              ) : (
                allocationProposals.map((allocation) => (
                  <TableRow key={allocation.id}>
                    <TableCell className="pl-6">{projectNameById.get(allocation.project_id) ?? "—"}</TableCell>
                    <TableCell>{allocation.role_on_project}</TableCell>
                    <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
                    <TableCell>
                      {formatDate(allocation.start_date)} – {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rejectAllocationMutation.isPending}
                          onClick={() => rejectAllocationMutation.mutate(allocation.id)}
                        >
                          <X className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          disabled={approveAllocationMutation.isPending}
                          onClick={() => approveAllocationMutation.mutate(allocation.id)}
                        >
                          <Check className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending Allocation Changes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {changesLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !allocationChanges || allocationChanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending rebaseline requests.</p>
          ) : (
            allocationChanges.map((allocation) => (
              <div key={allocation.id} className="rounded-md border p-4">
                <div className="flex items-start justify-between gap-4">
                  <span className="font-medium">{projectNameById.get(allocation.project_id) ?? "—"}</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rejectChangeMutation.isPending}
                      onClick={() => rejectChangeMutation.mutate(allocation.id)}
                    >
                      <X className="size-4" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={approveChangeMutation.isPending}
                      onClick={() => approveChangeMutation.mutate(allocation.id)}
                    >
                      <Check className="size-4" />
                      Approve
                    </Button>
                  </div>
                </div>

                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      <TableHead className="text-right">Hours/Wk</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Timeline</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-sm text-muted-foreground">Current</TableCell>
                      <TableCell className="text-right tabular-nums">{allocation.hours_per_week}</TableCell>
                      <TableCell>{allocation.priority}</TableCell>
                      <TableCell>
                        {formatDate(allocation.start_date)} –{" "}
                        {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-sm font-medium">Proposed</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {allocation.proposed_hours_per_week}
                      </TableCell>
                      <TableCell className="font-medium">{allocation.proposed_priority}</TableCell>
                      <TableCell className="font-medium">
                        {allocation.proposed_start_date ? formatDate(allocation.proposed_start_date) : "—"} –{" "}
                        {allocation.proposed_end_date ? formatDate(allocation.proposed_end_date) : "Ongoing"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
