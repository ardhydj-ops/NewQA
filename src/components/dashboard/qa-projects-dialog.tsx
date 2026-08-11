"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getInProgressProjectsForUser } from "@/features/dashboard-action";
import { formatDate } from "@/lib/format";
import type { ProjectStatus } from "@/lib/project";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  to_do: "To Do",
  ready_sit: "Ready to SIT",
  sit: "SIT",
  ready_uat: "Ready to UAT",
  uat: "UAT",
  completed: "Completed",
};

type QaProjectsDialogProps = {
  userId: string;
  userName: string;
  weekStart: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function QaProjectsDialog({ userId, userName, weekStart, open, onOpenChange }: QaProjectsDialogProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["qa-in-progress-projects", userId, weekStart],
    queryFn: () => getInProgressProjectsForUser(userId, weekStart),
    enabled: open,
  });

  const projects = data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{userName} — In Progress</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No in-progress items for this week.</p>
        ) : (
          <div className="space-y-2">
            {projects.map((project) => (
              <div key={project.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{project.name}</span>
                  <Badge variant="outline">{STATUS_LABEL[project.status]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(project.start_date)} – {project.end_date ? formatDate(project.end_date) : "Ongoing"}
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
