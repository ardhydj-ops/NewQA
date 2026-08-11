export type ProfileRole = "qa_lead" | "qa_member" | "project_manager";

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
