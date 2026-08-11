export type ProjectStatus =
  | "to_do"
  | "ready_sit"
  | "sit"
  | "ready_uat"
  | "uat"
  | "completed";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ItemType = "project" | "support_testing" | "problem_incident" | "service_request";

export type Priority = "low" | "medium" | "high" | "critical";

export type Project = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  product_id: string;
  status: ProjectStatus;
  progress_percent: number;
  item_type: ItemType;
  total_working_days: number;
  priority: Priority;
  jira_link: string;
  jiva_link: string;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  proposed_start_date: string | null;
  proposed_end_date: string | null;
  proposed_total_working_days: number | null;
  proposed_priority: Priority | null;
  change_proposed_by: string | null;
  change_requested_at: string | null;
  created_at: string;
  updated_at: string;
};
