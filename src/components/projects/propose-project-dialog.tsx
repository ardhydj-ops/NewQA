"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { ProductMultiSelect } from "@/components/products/product-multi-select";
import { getProducts } from "@/features/product-action";
import { proposeProject } from "@/features/project-action";
import type { ItemType, Priority, ProjectStatus } from "@/lib/project";

type ProposeProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProposeProjectDialog({ open, onOpenChange }: ProposeProjectDialogProps) {
  const [name, setName] = useState("");
  const [itemType, setItemType] = useState<ItemType>("project");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [status, setStatus] = useState<ProjectStatus>("to_do");
  const [priority, setPriority] = useState<Priority>("medium");
  const [jiraLink, setJiraLink] = useState("https://jpnqa.atlassian.net/jira");
  const [jivaLink, setJivaLink] = useState("https://jiva.jalin.co.id/");
  const [supportRequestFormLink, setSupportRequestFormLink] = useState("");
  const queryClient = useQueryClient();

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      proposeProject({
        project: {
          name,
          item_type: itemType,
          start_date: startDate,
          end_date: endDate,
          product_ids: productIds,
          status,
          progress_percent: 0,
          priority,
          jira_link: jiraLink,
          jiva_link: jivaLink,
          support_request_form_link: itemType === "support_testing" ? supportRequestFormLink : undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Proposal submitted — pending QA Lead approval");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setStartDate("");
      setEndDate("");
      setProductIds([]);
      setJiraLink("https://jpnqa.atlassian.net/jira");
      setJivaLink("https://jiva.jalin.co.id/");
      setSupportRequestFormLink("");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Propose item</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="proposal_name">Name</Label>
            <Input id="proposal_name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="proposal_item_type">Item Type</Label>
            <Select value={itemType} onValueChange={(value) => setItemType(value as ItemType)}>
              <SelectTrigger id="proposal_item_type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="support_testing">Support Testing</SelectItem>
                <SelectItem value="problem_incident">Problem Incident</SelectItem>
                <SelectItem value="service_request">Service Request</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_start">Start Date</Label>
              <Input id="proposal_start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_end">End Date</Label>
              <Input id="proposal_end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_product">Products</Label>
              <ProductMultiSelect products={products ?? []} selectedProductIds={productIds} onChange={setProductIds} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as ProjectStatus)}>
                <SelectTrigger id="proposal_status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="to_do">To Do</SelectItem>
                  <SelectItem value="ready_sit">Ready to SIT</SelectItem>
                  <SelectItem value="sit">SIT</SelectItem>
                  <SelectItem value="ready_uat">Ready to UAT</SelectItem>
                  <SelectItem value="uat">UAT</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_priority">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger id="proposal_priority" className="w-full">
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proposal_jira">JIRA Link</Label>
              <Input
                id="proposal_jira"
                type="url"
                placeholder="https://..."
                value={jiraLink}
                onChange={(e) => setJiraLink(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal_jiva">Jiva Link</Label>
              <Input
                id="proposal_jiva"
                type="url"
                placeholder="https://..."
                value={jivaLink}
                onChange={(e) => setJivaLink(e.target.value)}
                required
              />
            </div>
          </div>

          {itemType === "support_testing" && (
            <div className="space-y-2">
              <Label htmlFor="proposal_support_form">Support Request Form (SharePoint Link)</Label>
              <Input
                id="proposal_support_form"
                type="url"
                placeholder="https://...sharepoint.com/..."
                value={supportRequestFormLink}
                onChange={(e) => setSupportRequestFormLink(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Upload the Support Request Form to SharePoint yourself, then paste the link here.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                productIds.length === 0 ||
                (itemType === "support_testing" && !supportRequestFormLink.trim())
              }
            >
              {mutation.isPending ? "Submitting..." : "Submit proposal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
