import { z } from "zod";

export const SettingsInput = z.object({
  max_parallel_projects: z.number().int().positive("Must be a positive whole number"),
  email_notifications_enabled: z.boolean(),
});
export type SettingsInput = z.infer<typeof SettingsInput>;
