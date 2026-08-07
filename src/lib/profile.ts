export type ProfileRole = "qa_lead" | "qa_member" | "project_manager";

export type QaGroup =
  | "qris_h2h"
  | "qris_bo"
  | "digital_h2h"
  | "digital_bo"
  | "corporate_it";

export type Profile = {
  id: string;
  name: string;
  email: string;
  role: ProfileRole;
  qa_group: QaGroup | null;
  capacity_hours: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
