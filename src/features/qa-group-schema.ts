import { z } from "zod";

export const QaGroupInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  lead_user_id: z.string().uuid().nullable(),
});
export type QaGroupInput = z.infer<typeof QaGroupInput>;
