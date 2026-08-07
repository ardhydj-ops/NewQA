import { z } from "zod";

export const ProfileInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Enter a valid email"),
  role: z.enum(["qa_lead", "qa_member", "project_manager"]),
  qa_group: z
    .enum(["qris_h2h", "qris_bo", "digital_h2h", "digital_bo", "corporate_it"])
    .optional(),
  capacity_hours: z.number().positive("Capacity must be greater than 0"),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

// Editing never changes email (would require syncing auth.users separately).
export const ProfileUpdateInput = ProfileInput.omit({ email: true });
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateInput>;
