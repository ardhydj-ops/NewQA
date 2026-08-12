export type ProfileRole = "qa_lead" | "qa_member" | "project_manager" | "head_of_qa";

export const QA_LEAD_ROLES: ProfileRole[] = ["qa_lead", "head_of_qa"];

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: ProfileRole;
  qa_group_id: string | null;
  capacity_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
