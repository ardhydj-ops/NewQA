import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const AllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  project_id: z.string().uuid("Select a project"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  hours_per_week: z.number().positive("Hours must be greater than 0"),
  start_date: isoDate,
  end_date: isoDate.optional(),
});
export type AllocationInput = z.infer<typeof AllocationInput>;
