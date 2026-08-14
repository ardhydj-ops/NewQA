"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importProjectSchedule, type ImportRowResult } from "@/features/project-import-action";

const OUTCOME_LABEL: Record<ImportRowResult["outcome"], string> = {
  created: "Created",
  staged: "Staged",
  skipped: "Skipped",
  error: "Error",
};

const OUTCOME_BADGE_CLASS: Record<ImportRowResult["outcome"], string> = {
  created: "border-emerald-200 bg-emerald-50 text-emerald-700",
  staged: "border-blue-200 bg-blue-50 text-blue-700",
  skipped: "border-slate-200 bg-slate-50 text-slate-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

type ImportScheduleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ImportScheduleDialog({ open, onOpenChange }: ImportScheduleDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<ImportRowResult[] | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (f: File) => importProjectSchedule(f),
    onSuccess: (result) => {
      setResults(result.rows);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      setFile(null);
      setResults(null);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Schedule</DialogTitle>
          <DialogDescription>
            Upload an .xlsx file with Project Name, Start Date, and End Date columns. Every row becomes a
            proposal awaiting approval — nothing is added or changed until a QA Lead or Head of QA approves it.
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Project Name</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        No rows found in this file.
                      </TableCell>
                    </TableRow>
                  ) : (
                    results.map((r) => (
                      <TableRow key={r.row}>
                        <TableCell className="text-sm tabular-nums">{r.row}</TableCell>
                        <TableCell className="text-sm">{r.projectName || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={OUTCOME_BADGE_CLASS[r.outcome]}>
                            {OUTCOME_LABEL[r.outcome]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.detail}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <a
              href="/templates/project-schedule-template.xlsx"
              download
              className="text-sm text-primary underline underline-offset-4"
            >
              Download template
            </a>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <DialogFooter>
              <Button disabled={!file || mutation.isPending} onClick={() => file && mutation.mutate(file)}>
                {mutation.isPending ? "Uploading..." : "Upload"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
