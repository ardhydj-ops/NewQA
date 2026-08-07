import { redirect } from "next/navigation";

import { ApprovalsPageContent } from "@/components/approvals/approvals-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function ApprovalsPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "qa_lead") {
    redirect("/dashboard");
  }
  return <ApprovalsPageContent />;
}
