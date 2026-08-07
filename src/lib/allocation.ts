import type { ApprovalStatus } from "@/lib/project";

export type Allocation = {
  id: string;
  user_id: string;
  project_id: string;
  role_on_project: string;
  hours_per_week: number;
  start_date: string;
  end_date: string | null;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  created_at: string;
  updated_at: string;
};
