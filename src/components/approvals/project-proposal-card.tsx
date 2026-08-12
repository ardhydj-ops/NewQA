"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PendingProjectProposal } from "@/features/approval-action";
import { formatDate } from "@/lib/format";
import { monthsBetween } from "@/lib/load";

type ProjectProposalCardProps = {
  proposal: PendingProjectProposal;
  productNameById: Map<string, string>;
  onApprove: (totalWorkingDays: number) => void;
  onReject: () => void;
  approving: boolean;
  rejecting: boolean;
};

export function ProjectProposalCard({
  proposal,
  productNameById,
  onApprove,
  onReject,
  approving,
  rejecting,
}: ProjectProposalCardProps) {
  const [days, setDays] = useState(() =>
    proposal.end_date
      ? String(Math.round(monthsBetween(proposal.start_date, proposal.end_date) * 22 * 2) / 2)
      : "",
  );
  const parsedDays = Number(days);
  const canApprove = days.trim() !== "" && parsedDays > 0;

  return (
    <div className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{proposal.name}</span>
            {proposal.product_ids.map((productId) => (
              <Badge key={productId} variant="secondary">
                {productNameById.get(productId) ?? "—"}
              </Badge>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(proposal.start_date)} – {proposal.end_date ? formatDate(proposal.end_date) : "Ongoing"}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`days-${proposal.id}`} className="text-xs text-muted-foreground">
              Total Working Days
            </Label>
            <Input
              id={`days-${proposal.id}`}
              type="number"
              min={0.5}
              step={0.5}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-28"
            />
          </div>
          <Button size="sm" variant="outline" disabled={rejecting} onClick={onReject}>
            <X className="size-4" />
            Reject
          </Button>
          <Button size="sm" disabled={!canApprove || approving} onClick={() => onApprove(parsedDays)}>
            <Check className="size-4" />
            Approve
          </Button>
        </div>
      </div>

      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Days/Wk</TableHead>
            <TableHead>Timeline</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposal.allocations.map((allocation) => (
            <TableRow key={allocation.id}>
              <TableCell>{allocation.role_on_project}</TableCell>
              <TableCell>{productNameById.get(allocation.product_id) ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{allocation.days_per_week}</TableCell>
              <TableCell>
                {formatDate(allocation.start_date)} –{" "}
                {allocation.end_date ? formatDate(allocation.end_date) : "Ongoing"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
