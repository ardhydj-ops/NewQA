import type { ApprovalStatus, Priority } from "@/lib/project";

export type Allocation = {
  id: string;
  user_id: string;
  project_id: string;
  role_on_project: string;
  days_per_week: number;
  start_date: string;
  end_date: string | null;
  priority: Priority;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  proposed_start_date: string | null;
  proposed_end_date: string | null;
  proposed_days_per_week: number | null;
  proposed_priority: Priority | null;
  change_proposed_by: string | null;
  change_requested_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A row carrying a staged-but-not-yet-approved rebaseline request. */
export function hasPendingChange(allocation: Allocation): boolean {
  return allocation.proposed_start_date !== null;
}
