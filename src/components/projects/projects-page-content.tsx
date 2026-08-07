"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectTable } from "@/components/projects/project-table";
import { ProposeProjectDialog } from "@/components/projects/propose-project-dialog";
import { getProjects } from "@/features/project-action";
import type { Product, ProjectStatus } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

export function ProjectsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [productFilter, setProductFilter] = useState<Product | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["projects", { search, status: statusFilter, product: productFilter }],
    queryFn: () => getProjects({ search, status: statusFilter, product: productFilter }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Project Portfolio</h1>
          <p className="text-sm text-muted-foreground">Manage and track QA projects across all stages.</p>
        </div>
        {role === "qa_lead" && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Project
          </Button>
        )}
        {role === "project_manager" && (
          <Button onClick={() => setProposeOpen(true)}>
            <Plus className="size-4" />
            Propose Project
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects..." className="max-w-64" />
        <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : (v as ProjectStatus))}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="to_do">To Do</SelectItem>
            <SelectItem value="ready_sit">Ready to SIT</SelectItem>
            <SelectItem value="sit">SIT</SelectItem>
            <SelectItem value="ready_uat">Ready to UAT</SelectItem>
            <SelectItem value="uat">UAT</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={productFilter || "all"} onValueChange={(v) => setProductFilter(v === "all" ? "" : (v as Product))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            <SelectItem value="qris_h2h">QRIS H2H</SelectItem>
            <SelectItem value="qris_bo">QRIS BO</SelectItem>
            <SelectItem value="qrcb">QRCB</SelectItem>
            <SelectItem value="pi">PI</SelectItem>
            <SelectItem value="jv">JV</SelectItem>
            <SelectItem value="ccw">CCW</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ProjectTable rows={data ?? []} isLoading={isLoading} isError={isError} role={role} currentProfileId={currentProfileId} />

      {role === "qa_lead" && <ProjectFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />}
      {role === "project_manager" && <ProposeProjectDialog open={proposeOpen} onOpenChange={setProposeOpen} />}
    </div>
  );
}
