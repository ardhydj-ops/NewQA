import { z } from "zod";

export const ProductInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  qa_group_id: z.string().uuid().nullable(),
});
export type ProductInput = z.infer<typeof ProductInput>;
