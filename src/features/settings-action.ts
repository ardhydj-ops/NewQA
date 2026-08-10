"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { SettingsInput } from "@/features/settings-schema";
import type { AppSettings } from "@/lib/settings";

export async function getSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("max_parallel_projects")
    .eq("id", true)
    .single();
  if (error) throw new Error(error.message);
  return data as AppSettings;
}

export async function updateSettings(input: unknown): Promise<{ success: true }> {
  await requireRole(["qa_lead"]);

  const parsed = SettingsInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .update({ max_parallel_projects: parsed.data.max_parallel_projects })
    .eq("id", true);

  if (error) throw new Error(error.message);
  return { success: true };
}
