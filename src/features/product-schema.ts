import { z } from "zod";

export const ProductInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
});
export type ProductInput = z.infer<typeof ProductInput>;
