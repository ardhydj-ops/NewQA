import { ProjectsPageContent } from "@/components/projects/projects-page-content";
import { getCurrentProfile } from "@/lib/auth";

export default async function ProjectsPage() {
  const profile = await getCurrentProfile();
  return (
    <ProjectsPageContent
      role={profile!.role}
      currentProfileId={profile!.id}
      qaGroupId={profile!.qa_group_id}
    />
  );
}
