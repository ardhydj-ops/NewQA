"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MoreHorizontal, Pencil, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TeamFormDialog } from "@/components/team/team-form-dialog";
import { resetPassword, setProfileActive } from "@/features/profile-action";
import { getQaGroups } from "@/features/qa-group-action";
import type { Profile, ProfileRole } from "@/lib/profile";

const ROLE_LABEL: Record<ProfileRole, string> = {
  qa_lead: "QA Lead",
  qa_member: "QA Member",
  project_manager: "Project Manager",
  head_of_qa: "Head of QA",
};

type TeamTableProps = {
  rows: Profile[];
  isLoading: boolean;
  isError: boolean;
  canWrite: boolean;
  viewerRole: ProfileRole;
};

export function TeamTable({ rows, isLoading, isError, canWrite, viewerRole }: TeamTableProps) {
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [resetPasswordFor, setResetPasswordFor] = useState<Profile | null>(null);
  const [newTempPassword, setNewTempPassword] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });
  const qaGroupNameById = new Map((qaGroups ?? []).map((g) => [g.id, g.name]));

  // Head of QA first, then grouped by QA Group (in the same name order as
  // the Settings page), each group's lead pinned first within it,
  // unassigned/no-group profiles (including PMs) last — alphabetical by
  // name at every tie.
  const qaGroupOrder = new Map((qaGroups ?? []).map((g, i) => [g.id, i]));
  function sortRank(profile: Profile) {
    const headRank = profile.role === "head_of_qa" ? 0 : 1;
    const group = profile.qa_group_id ? (qaGroups ?? []).find((g) => g.id === profile.qa_group_id) : undefined;
    const groupRank = group ? (qaGroupOrder.get(group.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const leadRank = group?.lead_user_id === profile.id ? 0 : 1;
    return { headRank, groupRank, leadRank };
  }
  const sortedRows = [...rows].sort((a, b) => {
    const ra = sortRank(a);
    const rb = sortRank(b);
    return (
      ra.headRank - rb.headRank ||
      ra.groupRank - rb.groupRank ||
      ra.leadRank - rb.leadRank ||
      a.name.localeCompare(b.name)
    );
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setProfileActive(id, isActive),
    onSuccess: () => {
      toast.success("Team member updated");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) => resetPassword(id),
    onSuccess: (result) => setNewTempPassword(result.tempPassword),
    onError: (error: Error) => {
      toast.error(error.message);
      setResetPasswordFor(null);
    },
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
              <TableHead className="text-right">Capacity (days/wk)</TableHead>
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
              sortedRows.map((profile) => (
                <TableRow key={profile.id} className={!profile.is_active ? "opacity-50" : undefined}>
                  <TableCell className="pl-6 text-sm font-medium">{profile.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{profile.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABEL[profile.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {profile.qa_group_id ? (qaGroupNameById.get(profile.qa_group_id) ?? "—") : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{profile.capacity_days}</TableCell>
                  {canWrite && (
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(profile.role !== "head_of_qa" || viewerRole === "head_of_qa") && (
                            <DropdownMenuItem onSelect={() => setEditingProfile(profile)}>
                              <Pencil className="size-4" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() => {
                              setResetPasswordFor(profile);
                              resetPasswordMutation.mutate(profile.id);
                            }}
                          >
                            <KeyRound className="size-4" />
                            Reset Password
                          </DropdownMenuItem>
                          {(profile.role !== "head_of_qa" || viewerRole === "head_of_qa") && (
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
                          )}
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
          viewerRole={viewerRole}
        />
      )}

      <Dialog
        open={resetPasswordFor !== null}
        onOpenChange={(o) => {
          if (!o) {
            setResetPasswordFor(null);
            setNewTempPassword(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Password reset</DialogTitle>
            <DialogDescription>
              {newTempPassword
                ? `Share this temporary password with ${resetPasswordFor?.name} — it will not be shown again.`
                : "Generating a new temporary password..."}
            </DialogDescription>
          </DialogHeader>
          {newTempPassword && (
            <div className="rounded-md border bg-muted px-4 py-3 text-center font-mono text-lg tracking-wider">
              {newTempPassword}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={!newTempPassword}
              onClick={() => {
                setResetPasswordFor(null);
                setNewTempPassword(null);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
