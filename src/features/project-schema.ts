import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const ProjectInput = z.object({
  name: z.string().trim().min(1, "Project name is required"),
  start_date: isoDate,
  end_date: isoDate.optional(),
  product: z.enum(["qris_h2h", "qris_bo", "qrcb", "pi", "jv", "ccw"]),
  status: z.enum(["to_do", "ready_sit", "sit", "ready_uat", "uat", "completed"]),
  progress_percent: z.number().int().min(0).max(100),
});
export type ProjectInput = z.infer<typeof ProjectInput>;

export const ProposedAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  hours_per_week: z.number().positive("Hours must be greater than 0"),
  start_date: isoDate,
  end_date: isoDate.optional(),
});
export type ProposedAllocationInput = z.infer<typeof ProposedAllocationInput>;

export const ProjectProposalInput = z.object({
  project: ProjectInput,
  allocations: z.array(ProposedAllocationInput).min(1, "Add at least one tester assignment"),
});
export type ProjectProposalInput = z.infer<typeof ProjectProposalInput>;
