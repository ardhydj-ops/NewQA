export type Product = "qris_h2h" | "qris_bo" | "qrcb" | "pi" | "jv" | "ccw";

export type ProjectStatus =
  | "to_do"
  | "ready_sit"
  | "sit"
  | "ready_uat"
  | "uat"
  | "completed";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type Project = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  product: Product;
  status: ProjectStatus;
  progress_percent: number;
  approval_status: ApprovalStatus;
  proposed_by: string | null;
  created_at: string;
  updated_at: string;
};
