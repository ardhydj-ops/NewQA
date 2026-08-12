import { redirect } from "next/navigation";

import { SettingsPageContent } from "@/components/settings/settings-page-content";
import { getCurrentProfile } from "@/lib/auth";
import { QA_LEAD_ROLES } from "@/lib/profile";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile || !QA_LEAD_ROLES.includes(profile.role)) {
    redirect("/dashboard");
  }
  return <SettingsPageContent />;
}
