"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAllocation, getAssignedQaNames, getRemainingProjectDays } from "@/features/allocation-action";
import { getProducts } from "@/features/product-action";
import { cn } from "@/lib/utils";
import type { Priority, Project } from "@/lib/project";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";

type AllocationFormProps = {
  userId: string;
  userName: string;
  capacityDays: number;
  allocatedDays: number;
  projects: Project[];
  role: ProfileRole;
};

export function AllocationForm({ userId, userName, capacityDays, allocatedDays, projects, role }: AllocationFormProps) {
  const [projectId, setProjectId] = useState("");
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [roleOnProject, setRoleOnProject] = useState("QA Tester");
  const [startDate, setStartDate] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const queryClient = useQueryClient();

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId, productId],
    queryFn: () => getRemainingProjectDays(projectId, productId),
    enabled: projectId !== "" && productId !== "",
  });

  const { data: assignedQaNames } = useQuery({
    queryKey: ["assigned-qa-names", projectId, productId],
    queryFn: () => getAssignedQaNames(projectId, productId),
    enabled: projectId !== "" && productId !== "",
  });

  function handleProjectChange(value: string) {
    setProjectId(value);
    const project = projects.find((p) => p.id === value);
    setStartDate(project?.start_date ?? "");
    setProductId(project && project.product_ids.length === 1 ? project.product_ids[0] : "");
  }

  const remainingCapacity = Math.max(0, capacityDays - allocatedDays);
  const roundedRemainingCapacity = Math.round(remainingCapacity * 2) / 2;
  const canSubmit = projectId !== "" && productId !== "" && roleOnProject.trim() !== "" && startDate !== "";

  const mutation = useMutation({
    mutationFn: () =>
      createAllocation({
        user_id: userId,
        project_id: projectId,
        product_id: productId,
        role_on_project: roleOnProject,
        start_date: startDate,
        priority,
      }),
    onSuccess: (result) => {
      if (result.unplacedDays > 0) {
        toast.warning(
          `Scheduled ${result.placedDays} day(s) across ${result.weeksCreated} week(s) — ${result.unplacedDays} day(s) couldn't fit before the project's deadline.`,
        );
      } else {
        toast.success(
          QA_LEAD_ROLES.includes(role)
            ? `Assigned across ${result.weeksCreated} week(s)`
            : `Proposed across ${result.weeksCreated} week(s) — pending QA Lead approval`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["range-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations", "user", userId] });
      queryClient.invalidateQueries({ queryKey: ["remaining-project-days", projectId, productId] });
      queryClient.invalidateQueries({ queryKey: ["assigned-qa-names", projectId, productId] });
      setProjectId("");
      setProductId("");
      setRoleOnProject("QA Tester");
      setStartDate("");
      setPriority("medium");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="space-y-4"
    >
      <div className="rounded-md border bg-muted px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Selected Resource</span>
          <span className="font-medium">{userName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Remaining Capacity</span>
          <span className="font-medium">{roundedRemainingCapacity} days / week</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project">Target Project</Label>
        <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              id="project"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={projectPopoverOpen}
              className="w-full justify-between font-normal"
            >
              <span className={cn("truncate", !selectedProject && "text-muted-foreground")}>
                {selectedProject ? selectedProject.name : "Select a project..."}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
            <Command>
              <CommandInput placeholder="Search projects..." />
              <CommandList>
                <CommandEmpty>No projects found.</CommandEmpty>
                <CommandGroup>
                  {projects.map((project) => (
                    <CommandItem
                      key={project.id}
                      value={project.name}
                      onSelect={() => {
                        handleProjectChange(project.id);
                        setProjectPopoverOpen(false);
                      }}
                    >
                      <Check className={cn("size-4", project.id === projectId ? "opacity-100" : "opacity-0")} />
                      {project.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {selectedProject && (
          <>
            <p className="text-xs text-muted-foreground">
              Remaining days for this item:{" "}
              {remainingDays !== undefined ? `${Math.round(remainingDays * 2) / 2} days` : "..."}
            </p>
            {assignedQaNames && assignedQaNames.length > 0 && (
              <p className="text-xs text-muted-foreground">Already assigned: {assignedQaNames.join(", ")}</p>
            )}
          </>
        )}
      </div>

      {selectedProject && selectedProject.product_ids.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor="product">Product</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger id="product" className="w-full">
              <SelectValue placeholder="Select a product..." />
            </SelectTrigger>
            <SelectContent>
              {(products ?? [])
                .filter((product) => selectedProject.product_ids.includes(product.id))
                .map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="role_on_project">Role on Project</Label>
        <Input
          id="role_on_project"
          value={roleOnProject}
          onChange={(e) => setRoleOnProject(e.target.value)}
          placeholder="e.g. Lead QA"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="priority">Priority</Label>
        <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
          <SelectTrigger id="priority" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="start_date">Start Date</Label>
        <Input
          id="start_date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          min={selectedProject?.start_date}
          max={selectedProject?.end_date ?? undefined}
          required
          disabled={!projectId}
        />
      </div>

      {startDate !== "" && (
        <p className="text-sm text-muted-foreground">
          Assigned days are scheduled week by week at this QA&apos;s available capacity, continuing into future
          weeks as needed.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? "Assigning..." : QA_LEAD_ROLES.includes(role) ? "Assign Resource" : "Propose Assignment"}
        </Button>
      </div>
    </form>
  );
}
