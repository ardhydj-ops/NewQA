"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TeamFormDialog } from "@/components/team/team-form-dialog";
import { TeamTable } from "@/components/team/team-table";
import { getProfiles } from "@/features/profile-action";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";

export function TeamPageContent({ role, viewerId }: { role: ProfileRole; viewerId: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const canWrite = QA_LEAD_ROLES.includes(role);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => getProfiles(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Team Management</h1>
          <p className="text-sm text-muted-foreground">Manage QA resources, roles, and capacity.</p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Add User
          </Button>
        )}
      </div>

      <TeamTable
        rows={data ?? []}
        isLoading={isLoading}
        isError={isError}
        canWrite={canWrite}
        viewerRole={role}
        viewerId={viewerId}
      />

      {canWrite && (
        <TeamFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} viewerRole={role} />
      )}
    </div>
  );
}
