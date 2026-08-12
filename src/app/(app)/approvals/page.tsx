import { redirect } from "next/navigation";

import { ApprovalsPageContent } from "@/components/approvals/approvals-page-content";
import { getCurrentProfile } from "@/lib/auth";
import { QA_LEAD_ROLES } from "@/lib/profile";

export default async function ApprovalsPage() {
  const profile = await getCurrentProfile();
  if (!profile || !QA_LEAD_ROLES.includes(profile.role)) {
    redirect("/dashboard");
  }
  return <ApprovalsPageContent />;
}
