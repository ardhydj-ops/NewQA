import { TeamPageContent } from "@/components/team/team-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function TeamPage() {
  const profile = await getCurrentProfile();
  return <TeamPageContent role={profile!.role} />;
}
