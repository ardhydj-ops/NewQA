"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProfile, updateProfile } from "@/features/profile-action";
import { getQaGroups } from "@/features/qa-group-action";
import type { Profile, ProfileRole } from "@/lib/profile";

type FormState = {
  name: string;
  email: string;
  role: ProfileRole;
  qa_group_id: string; // "none" sentinel, or a qa_groups.id
  capacity_days: string;
};

function formFromProfile(profile?: Profile): FormState {
  return profile
    ? {
        name: profile.name,
        email: profile.email,
        role: profile.role,
        qa_group_id: profile.qa_group_id ?? "none",
        capacity_days: String(profile.capacity_days),
      }
    : { name: "", email: "", role: "qa_member", qa_group_id: "none", capacity_days: "5" };
}

type TeamFormDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: Profile;
};

export function TeamFormDialog({ mode, open, onOpenChange, initialValue }: TeamFormDialogProps) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState<FormState>(() => formFromProfile(initialValue));
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: qaGroups } = useQuery({
    queryKey: ["qa-groups"],
    queryFn: () => getQaGroups(),
  });

  const mutation = useMutation<
    { profile: Profile; tempPassword: string } | { success: true },
    Error,
    void
  >({
    mutationFn: () => {
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role,
        qa_group_id: form.qa_group_id === "none" ? undefined : form.qa_group_id,
        capacity_days: Number(form.capacity_days),
      };
      return isEdit && initialValue
        ? updateProfile(initialValue.id, payload)
        : createProfile(payload);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      if (!isEdit && result && "tempPassword" in result) {
        setTempPassword(result.tempPassword);
      } else {
        toast.success("Team member updated");
        onOpenChange(false);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setTempPassword(null);
      setForm(formFromProfile());
    }
    onOpenChange(nextOpen);
  }

  if (tempPassword) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>User created</DialogTitle>
            <DialogDescription>
              Share this temporary password with {form.name} — it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted px-4 py-3 text-center font-mono text-lg tracking-wider">
            {tempPassword}
          </div>
          <DialogFooter>
            <Button onClick={() => handleClose(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this team member's details." : "Creates a profile and a login for this team member."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              disabled={isEdit}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={form.role} onValueChange={(value) => setForm((f) => ({ ...f, role: value as ProfileRole }))}>
                <SelectTrigger id="role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qa_lead">QA Lead</SelectItem>
                  <SelectItem value="qa_member">QA Member</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="capacity">Capacity (days/wk)</Label>
              <Input
                id="capacity"
                type="number"
                min={0.5}
                step={0.5}
                value={form.capacity_days}
                onChange={(e) => setForm((f) => ({ ...f, capacity_days: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qa_group">QA Group</Label>
            <Select
              value={form.qa_group_id}
              onValueChange={(value) => setForm((f) => ({ ...f, qa_group_id: value }))}
            >
              <SelectTrigger id="qa_group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(qaGroups ?? []).map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : isEdit ? "Save" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
