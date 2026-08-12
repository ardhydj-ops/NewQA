"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RejectSubmissionDialog } from "@/components/testing-approvals/reject-submission-dialog";
import {
  approveTestingSubmission,
  getTestingSubmissions,
  submitTestingDocument,
} from "@/features/testing-approval-action";
import { getProfiles } from "@/features/profile-action";
import { getProjects } from "@/features/project-action";
import { formatDateTime } from "@/lib/format";
import type { SubmissionStatus } from "@/lib/testing-approval";
import type { ProfileRole } from "@/lib/profile";

const STATUS_BADGE_CLASS: Record<SubmissionStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export function TestingApprovalsPageContent({ role }: { role: ProfileRole }) {
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitProjectId, setSubmitProjectId] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const isQaLead = role === "qa_lead";
  const isHeadOfQa = role === "head_of_qa";

  const { data: submissions, isLoading } = useQuery({
    queryKey: ["testing-submissions"],
    queryFn: () => getTestingSubmissions(),
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => getProfiles(),
  });
  const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  const { data: approvedProjects } = useQuery({
    queryKey: ["projects", { approvalStatus: "approved" }],
    queryFn: () => getProjects({ approvalStatus: "approved" }),
    enabled: isQaLead,
  });

  const rows = submissions ?? [];
  const pendingProjectIds = new Set(rows.filter((s) => s.status === "pending").map((s) => s.project_id));
  const submittableProjects = (approvedProjects ?? []).filter(
    (p) => p.progress_percent === 100 && !pendingProjectIds.has(p.id),
  );

  const submitMutation = useMutation({
    mutationFn: () => submitTestingDocument(submitProjectId),
    onSuccess: () => {
      toast.success("Submitted for approval");
      queryClient.invalidateQueries({ queryKey: ["testing-submissions"] });
      setSubmitProjectId("");
      setSubmitOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveMutation = useMutation({
    mutationFn: approveTestingSubmission,
    onSuccess: () => {
      toast.success("Submission approved");
      queryClient.invalidateQueries({ queryKey: ["testing-submissions"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columnCount = isHeadOfQa ? 9 : 8;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Testing Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Submit completed items for Head of QA sign-off and track approval history.
          </p>
        </div>
        {isQaLead && <Button onClick={() => setSubmitOpen(true)}>Submit for Approval</Button>}
      </div>

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Project</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted By</TableHead>
                <TableHead>Submitted At</TableHead>
                <TableHead>Decided By</TableHead>
                <TableHead>Decided At</TableHead>
                <TableHead className={isHeadOfQa ? "" : "pr-6"}>Comment</TableHead>
                {isHeadOfQa && <TableHead className="pr-6 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                    No submissions yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell className="pl-6 text-sm font-medium">{submission.project_name}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {submission.project_jira_link && (
                          <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-xs" asChild>
                            <a href={submission.project_jira_link} target="_blank" rel="noopener noreferrer">
                              JIRA <ExternalLink className="size-3" />
                            </a>
                          </Button>
                        )}
                        {submission.project_jiva_link && (
                          <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-xs" asChild>
                            <a href={submission.project_jiva_link} target="_blank" rel="noopener noreferrer">
                              Jiva <ExternalLink className="size-3" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_BADGE_CLASS[submission.status]}>
                        {STATUS_LABEL[submission.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {profileNameById.get(submission.submitted_by) ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(submission.submitted_at)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {submission.decided_by ? (profileNameById.get(submission.decided_by) ?? "—") : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {submission.decided_at ? formatDateTime(submission.decided_at) : "—"}
                    </TableCell>
                    <TableCell className={`text-sm text-muted-foreground ${isHeadOfQa ? "" : "pr-6"}`}>
                      {submission.rejection_comment ?? "—"}
                    </TableCell>
                    {isHeadOfQa && (
                      <TableCell className="pr-6 text-right">
                        {submission.status === "pending" && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setRejectingId(submission.id)}>
                              <X className="size-4" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate(submission.id)}
                            >
                              <Check className="size-4" />
                              Approve
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit for Approval</DialogTitle>
            <DialogDescription>
              The Head of QA will review this item&apos;s Jira/Jiva links and record a decision.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitMutation.mutate();
            }}
            className="space-y-4"
          >
            <Select value={submitProjectId} onValueChange={setSubmitProjectId}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    submittableProjects.length === 0
                      ? "No eligible items (must be 100% complete)"
                      : "Select an item..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {submittableProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button type="submit" disabled={!submitProjectId || submitMutation.isPending}>
                {submitMutation.isPending ? "Submitting..." : "Submit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {rejectingId && (
        <RejectSubmissionDialog
          submissionId={rejectingId}
          open
          onOpenChange={(o) => {
            if (!o) setRejectingId(null);
          }}
        />
      )}
    </div>
  );
}
