import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const AllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  project_id: z.string().uuid("Select a project"),
  product_id: z.string().uuid("Select a product"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  days_per_week: z
    .number()
    .positive("Days must be greater than 0")
    .multipleOf(0.5, "Days must be in half-day increments"),
  start_date: isoDate,
  end_date: isoDate.optional(),
  priority: z.enum(["low", "medium", "high", "critical"]),
});
export type AllocationInput = z.infer<typeof AllocationInput>;

export const AllocationChangeInput = z.object({
  start_date: isoDate,
  end_date: isoDate.optional(),
  days_per_week: z
    .number()
    .positive("Days must be greater than 0")
    .multipleOf(0.5, "Days must be in half-day increments"),
  priority: z.enum(["low", "medium", "high", "critical"]),
});
export type AllocationChangeInput = z.infer<typeof AllocationChangeInput>;

export const BulkAllocationInput = z.object({
  project_id: z.string().uuid("Select a project"),
  product_id: z.string().uuid("Select a product"),
  user_ids: z.array(z.string().uuid()).min(1, "Select at least one QA member"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
});
export type BulkAllocationInput = z.infer<typeof BulkAllocationInput>;

export const ScheduleAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  project_id: z.string().uuid("Select a project"),
  product_id: z.string().uuid("Select a product"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  start_date: isoDate,
  priority: z.enum(["low", "medium", "high", "critical"]),
});
export type ScheduleAllocationInput = z.infer<typeof ScheduleAllocationInput>;
