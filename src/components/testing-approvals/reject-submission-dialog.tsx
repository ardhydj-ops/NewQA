"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rejectTestingSubmission } from "@/features/testing-approval-action";

type RejectSubmissionDialogProps = {
  submissionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RejectSubmissionDialog({ submissionId, open, onOpenChange }: RejectSubmissionDialogProps) {
  const [comment, setComment] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => rejectTestingSubmission(submissionId, { comment }),
    onSuccess: () => {
      toast.success("Submission rejected");
      queryClient.invalidateQueries({ queryKey: ["testing-submissions"] });
      setComment("");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject submission</DialogTitle>
          <DialogDescription>A comment is required so the QA Lead knows what to fix.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="reject_comment">Comment</Label>
            <Textarea id="reject_comment" value={comment} onChange={(e) => setComment(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={!comment.trim() || mutation.isPending}>
              {mutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
