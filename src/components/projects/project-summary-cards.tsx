"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { Project, ProjectStatus } from "@/lib/project";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  to_do: "To Do",
  ready_sit: "Ready to SIT",
  sit: "SIT",
  ready_uat: "Ready to UAT",
  uat: "UAT",
  completed: "Completed",
};

const STATUS_ORDER: ProjectStatus[] = ["to_do", "ready_sit", "sit", "ready_uat", "uat", "completed"];

const PROGRESS_BUCKETS = [
  { label: "0–25%", min: 0, max: 25 },
  { label: "25–50%", min: 25, max: 50 },
  { label: "50–75%", min: 50, max: 75 },
  { label: "75–100%", min: 75, max: 100 },
];

type ProjectSummaryCardsProps = {
  rows: Project[];
  assignmentCounts: Record<string, number>;
  productNameById: Map<string, string>;
};

export function ProjectSummaryCards({ rows, assignmentCounts, productNameById }: ProjectSummaryCardsProps) {
  const totalProjects = rows.length;
  const withoutQa = rows.filter((p) => (assignmentCounts[p.id] ?? 0) === 0).length;

  const progressCounts = PROGRESS_BUCKETS.map((bucket) => ({
    ...bucket,
    count: rows.filter((p) =>
      bucket.max === 100
        ? p.progress_percent >= bucket.min && p.progress_percent <= bucket.max
        : p.progress_percent >= bucket.min && p.progress_percent < bucket.max,
    ).length,
  }));

  const statusCounts = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    count: rows.filter((p) => p.status === status).length,
  }));

  const productCounts = new Map<string, number>();
  for (const project of rows) {
    productCounts.set(project.product_id, (productCounts.get(project.product_id) ?? 0) + 1);
  }
  const productCountRows = [...productCounts.entries()]
    .map(([productId, count]) => ({ productId, name: productNameById.get(productId) ?? "—", count }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Total Projects</p>
            <p className="text-3xl font-bold tabular-nums">{totalProjects}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-6">
            <p className="text-xs font-medium uppercase text-muted-foreground">Without QA Assignment</p>
            <p className="text-3xl font-bold tabular-nums">{withoutQa}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">Progress Summary</h2>
            <div className="space-y-2">
              {progressCounts.map((bucket) => (
                <div key={bucket.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{bucket.label}</span>
                  <span className="font-medium tabular-nums">{bucket.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">By Status</h2>
            <div className="space-y-2">
              {statusCounts.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-medium tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">By Product</h2>
            <div className="space-y-2">
              {productCountRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              ) : (
                productCountRows.map((p) => (
                  <div key={p.productId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-muted-foreground">{p.name}</span>
                    <span className="font-medium tabular-nums">{p.count}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
