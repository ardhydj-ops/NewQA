import { createClient } from "@/lib/supabase/server";
import type { Profile, ProfileRole } from "@/lib/profile";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (data as Profile) ?? null;
}

export async function requireRole(allowed: ProfileRole[]): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in");
  if (!profile.is_active) throw new Error("This account has been deactivated");
  if (!allowed.includes(profile.role)) throw new Error("You are not authorized to do this");
  return profile;
}
