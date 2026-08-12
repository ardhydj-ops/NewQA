import { z } from "zod";

export const RejectSubmissionInput = z.object({
  comment: z.string().trim().min(1, "A comment is required to reject"),
});
export type RejectSubmissionInput = z.infer<typeof RejectSubmissionInput>;
