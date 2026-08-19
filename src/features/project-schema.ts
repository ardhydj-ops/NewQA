import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const ProjectInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  item_type: z.enum(["project", "support_testing", "problem_incident", "service_request"]),
  start_date: isoDate,
  end_date: isoDate,
  product_ids: z.array(z.string().uuid()).min(1, "Select at least one product"),
  status: z.enum(["to_do", "ready_sit", "sit", "ready_uat", "uat", "completed"]),
  progress_percent: z.number().int().min(0).max(100),
  total_working_days: z
    .number()
    .positive("Total working days must be greater than 0")
    .multipleOf(0.5, "Total working days must be in half-day increments"),
  priority: z.enum(["low", "medium", "high", "critical"]),
  jira_link: z.string().trim().url("Enter a valid JIRA URL"),
  jiva_link: z.string().trim().url("Enter a valid Jiva URL"),
  support_request_form_link: z.string().trim().url("Enter a valid link").optional(),
});
export type ProjectInput = z.infer<typeof ProjectInput>;

// PM proposals never set Total Working Days — the QA Lead fills it in at
// approval time (see ApproveProjectProposalInput below). Every other field,
// including jira_link/jiva_link, stays required on the proposal path too.
// A Support Testing proposal additionally requires a
// support_request_form_link (a SharePoint link the PM pastes in — there's
// no automated upload path) — every other item type leaves it unset.
const ProjectProposalProjectInput = ProjectInput.partial({ total_working_days: true }).superRefine((data, ctx) => {
  if (data.item_type === "support_testing" && !data.support_request_form_link) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["support_request_form_link"],
      message: "Support Request Form link is required for Support Testing items",
    });
  }
});
export type ProjectProposalProjectInput = z.infer<typeof ProjectProposalProjectInput>;

export const ProposedAllocationInput = z.object({
  user_id: z.string().uuid("Select a tester"),
  product_id: z.string().uuid("Select a product"),
  role_on_project: z.string().trim().min(1, "Role on project is required"),
  days_per_week: z
    .number()
    .positive("Days must be greater than 0")
    .multipleOf(0.5, "Days must be in half-day increments"),
  start_date: isoDate,
  end_date: isoDate.optional(),
});
export type ProposedAllocationInput = z.infer<typeof ProposedAllocationInput>;

export const ProjectProposalInput = z.object({
  project: ProjectProposalProjectInput,
  allocations: z.array(ProposedAllocationInput).default([]),
});
export type ProjectProposalInput = z.infer<typeof ProjectProposalInput>;

export const ApproveProjectProposalInput = z.object({
  total_working_days: z
    .number()
    .positive("Total working days must be greater than 0")
    .multipleOf(0.5, "Total working days must be in half-day increments"),
});
export type ApproveProjectProposalInput = z.infer<typeof ApproveProjectProposalInput>;

export const ProjectChangeInput = z.object({
  start_date: isoDate,
  end_date: isoDate,
  total_working_days: z
    .number()
    .positive("Total working days must be greater than 0")
    .multipleOf(0.5, "Total working days must be in half-day increments"),
  priority: z.enum(["low", "medium", "high", "critical"]),
});
export type ProjectChangeInput = z.infer<typeof ProjectChangeInput>;
