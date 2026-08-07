import { AllocationsPageContent } from "@/components/allocations/allocations-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function AllocationsPage() {
  const profile = await getCurrentProfile();
  return <AllocationsPageContent role={profile!.role} currentProfileId={profile!.id} />;
}
