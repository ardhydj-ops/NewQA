import { redirect } from "next/navigation";

import { SettingsPageContent } from "@/components/settings/settings-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "qa_lead") {
    redirect("/dashboard");
  }
  return <SettingsPageContent />;
}
