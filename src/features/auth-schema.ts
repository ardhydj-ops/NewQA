import { z } from "zod";

export const ChangePasswordInput = z.object({
  current_password: z.string().min(1, "Current password is required"),
  new_password: z.string().min(8, "New password must be at least 8 characters"),
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;
