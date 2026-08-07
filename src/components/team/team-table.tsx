"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TeamFormDialog } from "@/components/team/team-form-dialog";
import { setProfileActive } from "@/features/profile-action";
import type { Profile, ProfileRole, QaGroup } from "@/lib/profile";

const ROLE_LABEL: Record<ProfileRole, string> = {
  qa_lead: "QA Lead",
  qa_member: "QA Member",
  project_manager: "Project Manager",
};

const QA_GROUP_LABEL: Record<QaGroup, string> = {
  qris_h2h: "QRIS H2H",
  qris_bo: "QRIS BO",
  digital_h2h: "Digital H2H",
  digital_bo: "Digital BO",
  corporate_it: "Corporate IT",
};

type TeamTableProps = {
  rows: Profile[];
  isLoading: boolean;
  isError: boolean;
  canWrite: boolean;
};

export function TeamTable({ rows, isLoading, isError, canWrite }: TeamTableProps) {
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const queryClient = useQueryClient();

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setProfileActive(id, isActive),
    onSuccess: () => {
      toast.success("Team member updated");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columnCount = canWrite ? 6 : 5;

  return (
    <Card>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>QA Group</TableHead>
              <TableHead className="text-right">Capacity (hrs/wk)</TableHead>
              {canWrite && <TableHead className="pr-6 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                  {canWrite && <TableCell className="pr-6"><Skeleton className="ml-auto size-8 rounded-md" /></TableCell>}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  Failed to load team members.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-sm text-muted-foreground">
                  No team members yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((profile) => (
                <TableRow key={profile.id} className={!profile.is_active ? "opacity-50" : undefined}>
                  <TableCell className="pl-6 text-sm font-medium">{profile.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{profile.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABEL[profile.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {profile.qa_group ? QA_GROUP_LABEL[profile.qa_group] : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{profile.capacity_hours}</TableCell>
                  {canWrite && (
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditingProfile(profile)}>
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              toggleActiveMutation.mutate({ id: profile.id, isActive: !profile.is_active })
                            }
                          >
                            {profile.is_active ? (
                              <>
                                <UserX className="size-4" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <UserCheck className="size-4" />
                                Reactivate
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {editingProfile && (
        <TeamFormDialog
          key={editingProfile.id}
          mode="edit"
          open
          onOpenChange={(o) => {
            if (!o) setEditingProfile(null);
          }}
          initialValue={editingProfile}
        />
      )}
    </Card>
  );
}
