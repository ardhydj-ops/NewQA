import { redirect } from "next/navigation";

import { TestingApprovalsPageContent } from "@/components/testing-approvals/testing-approvals-page-content";
import { getCurrentProfile } from "@/lib/auth";
import type { ProfileRole } from "@/lib/profile";

const ALLOWED_ROLES: ProfileRole[] = ["qa_lead", "head_of_qa", "project_manager"];

export default async function TestingApprovalsPage() {
  const profile = await getCurrentProfile();
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard");
  }
  return <TestingApprovalsPageContent role={profile.role} />;
}
