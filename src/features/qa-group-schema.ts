import { z } from "zod";

export const QaGroupInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
});
export type QaGroupInput = z.infer<typeof QaGroupInput>;
