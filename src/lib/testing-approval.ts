export type SubmissionStatus = "pending" | "approved" | "rejected";

export type TestingDocumentSubmission = {
  id: string;
  project_id: string;
  status: SubmissionStatus;
  submitted_by: string;
  submitted_at: string;
  decided_by: string | null;
  decided_at: string | null;
  rejection_comment: string | null;
  created_at: string;
};
