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
import { getApprovedAllocationCountsByProject } from "@/features/allocation-action";
import { getProducts } from "@/features/product-action";
import { getProjects } from "@/features/project-action";
import type { ProjectStatus } from "@/lib/project";
import type { ProfileRole } from "@/lib/profile";

export function ProjectsPageContent({ role, currentProfileId }: { role: ProfileRole; currentProfileId: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [productFilter, setProductFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["projects", { search, status: statusFilter, product_id: productFilter }],
    queryFn: () => getProjects({ search, status: statusFilter, product_id: productFilter }),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const { data: assignmentCounts } = useQuery({
    queryKey: ["allocation-counts", "approved"],
    queryFn: () => getApprovedAllocationCountsByProject(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Project Portfolio</h1>
          <p className="text-sm text-muted-foreground">
            Manage and track projects, support testing, problem incidents, and service requests.
          </p>
        </div>
        {role === "qa_lead" && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Item
          </Button>
        )}
        {role === "project_manager" && (
          <Button onClick={() => setProposeOpen(true)}>
            <Plus className="size-4" />
            Propose Item
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="max-w-64" />
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
        <Select value={productFilter || "all"} onValueChange={(v) => setProductFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {(products ?? []).map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ProjectTable
        rows={data ?? []}
        isLoading={isLoading}
        isError={isError}
        role={role}
        currentProfileId={currentProfileId}
        productNameById={productNameById}
        assignmentCounts={assignmentCounts ?? {}}
      />

      {role === "qa_lead" && <ProjectFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />}
      {role === "project_manager" && <ProposeProjectDialog open={proposeOpen} onOpenChange={setProposeOpen} />}
    </div>
  );
}
