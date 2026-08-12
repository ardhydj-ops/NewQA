"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBulkAllocations, getRemainingProjectDays } from "@/features/allocation-action";
import { getAssignableProfiles } from "@/features/profile-action";
import { getProducts } from "@/features/product-action";
import { getProjects } from "@/features/project-action";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/project";
import { QA_LEAD_ROLES, type ProfileRole } from "@/lib/profile";

type BulkAssignDialogProps = {
  role: ProfileRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the project picker is skipped and this project is used directly. */
  presetProject?: Project;
};

export function BulkAssignDialog({ role, open, onOpenChange, presetProject }: BulkAssignDialogProps) {
  const [projectId, setProjectId] = useState(presetProject?.id ?? "");
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
  const [productId, setProductId] = useState(
    presetProject && presetProject.product_ids.length === 1 ? presetProject.product_ids[0] : "",
  );
  const [roleOnProject, setRoleOnProject] = useState("QA Tester");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [testerSearch, setTesterSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: projects } = useQuery({
    queryKey: ["projects", { approvalStatus: "approved" }],
    queryFn: () => getProjects({ approvalStatus: "approved" }),
    enabled: !presetProject,
  });

  const { data: testers } = useQuery({
    queryKey: ["assignable-profiles"],
    queryFn: () => getAssignableProfiles(),
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const selectedProject = presetProject ?? (projects ?? []).find((p) => p.id === projectId) ?? null;

  const filteredTesters = (testers ?? []).filter((tester) =>
    tester.name.toLowerCase().includes(testerSearch.trim().toLowerCase()),
  );

  const { data: remainingDays } = useQuery({
    queryKey: ["remaining-project-days", projectId, productId],
    queryFn: () => getRemainingProjectDays(projectId, productId),
    enabled: projectId !== "" && productId !== "",
  });

  const mutation = useMutation({
    mutationFn: () =>
      createBulkAllocations({
        project_id: projectId,
        product_id: productId,
        user_ids: selectedUserIds,
        role_on_project: roleOnProject,
      }),
    onSuccess: (result) => {
      if (result.created.length > 0) {
        const partiallyPlaced = result.created.filter((c) => c.unplacedDays > 0);
        if (partiallyPlaced.length === 0) {
          toast.success(
            QA_LEAD_ROLES.includes(role)
              ? `Assigned ${result.created.length} QA member(s)`
              : `Proposed assignment for ${result.created.length} QA member(s) — pending QA Lead approval`,
          );
        } else {
          const names = partiallyPlaced
            .map((c) => (testers ?? []).find((t) => t.id === c.userId)?.name ?? c.userId)
            .join(", ");
          toast.warning(`Assigned ${result.created.length} QA member(s), but couldn't fit all days for: ${names}`);
        }
      }
      if (result.failed.length > 0) {
        const names = result.failed
          .map((f) => (testers ?? []).find((t) => t.id === f.userId)?.name ?? f.userId)
          .join(", ");
        toast.error(`Could not assign: ${names}`);
      }
      queryClient.invalidateQueries({ queryKey: ["weekly-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["range-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["allocations"] });
      queryClient.invalidateQueries({ queryKey: ["remaining-project-days", projectId, productId] });
      queryClient.invalidateQueries({ queryKey: ["allocation-counts", "approved"] });
      setProjectId(presetProject?.id ?? "");
      setProductId(presetProject && presetProject.product_ids.length === 1 ? presetProject.product_ids[0] : "");
      setRoleOnProject("QA Tester");
      setSelectedUserIds([]);
      setTesterSearch("");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function toggleUser(userId: string, checked: boolean) {
    setSelectedUserIds((current) => (checked ? [...current, userId] : current.filter((id) => id !== userId)));
  }

  function handleProjectChange(value: string) {
    setProjectId(value);
    const project = (projects ?? []).find((p) => p.id === value);
    setProductId(project && project.product_ids.length === 1 ? project.product_ids[0] : "");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{presetProject ? "Assign QA" : "Add project"}</DialogTitle>
          <DialogDescription>
            Each selected QA is scheduled for the full remaining workload at their own available capacity,
            spilling into future weeks as needed.
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
            <Label htmlFor="bulk_project">Project / Activity</Label>
            {presetProject ? (
              <p className="text-sm font-medium">{presetProject.name}</p>
            ) : (
              <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="bulk_project"
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
                        {(projects ?? []).map((project) => (
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
            )}
            {selectedProject && (
              <p className="text-xs text-muted-foreground">
                Remaining days for this item:{" "}
                {remainingDays !== undefined ? `${Math.round(remainingDays * 2) / 2} days` : "..."}
              </p>
            )}
          </div>

          {selectedProject && selectedProject.product_ids.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="bulk_product">Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger id="bulk_product" className="w-full">
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
            <Label htmlFor="bulk_role">Role on Project</Label>
            <Input id="bulk_role" value={roleOnProject} onChange={(e) => setRoleOnProject(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk_tester_search">QA Members</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="bulk_tester_search"
                value={testerSearch}
                onChange={(e) => setTesterSearch(e.target.value)}
                placeholder="Search QA members..."
                className="pl-9"
              />
            </div>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
              {filteredTesters.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted-foreground">No QA members found.</p>
              ) : (
                filteredTesters.map((tester) => (
                  <label key={tester.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedUserIds.includes(tester.id)}
                      onCheckedChange={(checked) => toggleUser(tester.id, checked === true)}
                    />
                    {tester.name}
                  </label>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!projectId || !productId || selectedUserIds.length === 0 || mutation.isPending}>
              {mutation.isPending ? "Assigning..." : "Assign selected"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
