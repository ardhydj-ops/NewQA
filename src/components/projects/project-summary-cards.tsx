"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import type { Project, ProjectStatus } from "@/lib/project";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

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

type Slice = { id: string; name: string; value: number; color?: string };

function SummaryPieChart({ data, emptyMessage }: { data: Slice[]; emptyMessage: string }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
            {data.map((slice, index) => (
              <Cell key={slice.id} fill={slice.color ?? COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

type ProjectSummaryCardsProps = {
  rows: Project[];
  assignmentCounts: Record<string, number>;
  productNameById: Map<string, string>;
};

export function ProjectSummaryCards({ rows, assignmentCounts, productNameById }: ProjectSummaryCardsProps) {
  const totalProjects = rows.length;
  const withoutQa = rows.filter((p) => (assignmentCounts[p.id] ?? 0) === 0).length;

  const progressSlices: Slice[] = PROGRESS_BUCKETS.map((bucket) => ({
    id: bucket.label,
    name: bucket.label,
    value: rows.filter((p) =>
      bucket.max === 100
        ? p.progress_percent >= bucket.min && p.progress_percent <= bucket.max
        : p.progress_percent >= bucket.min && p.progress_percent < bucket.max,
    ).length,
  })).filter((slice) => slice.value > 0);

  const statusSlices: Slice[] = STATUS_ORDER.map((status) => ({
    id: status,
    name: STATUS_LABEL[status],
    value: rows.filter((p) => p.status === status).length,
  })).filter((slice) => slice.value > 0);

  const productCounts = new Map<string, number>();
  for (const project of rows) {
    for (const productId of project.product_ids) {
      productCounts.set(productId, (productCounts.get(productId) ?? 0) + 1);
    }
  }
  const productCountRows = [...productCounts.entries()]
    .map(([productId, count]) => ({ productId, name: productNameById.get(productId) ?? "—", count }))
    .sort((a, b) => b.count - a.count);
  const topProducts = productCountRows.slice(0, 5);
  const otherProductCount = productCountRows.slice(5).reduce((sum, p) => sum + p.count, 0);
  const productSlices: Slice[] = [
    ...topProducts.map((p) => ({ id: p.productId, name: p.name, value: p.count })),
    ...(otherProductCount > 0 ? [{ id: "other", name: "Other", value: otherProductCount }] : []),
  ];

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
            <SummaryPieChart data={progressSlices} emptyMessage="No items yet." />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">By Status</h2>
            <SummaryPieChart data={statusSlices} emptyMessage="No items yet." />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <h2 className="text-sm font-semibold">By Product</h2>
            <SummaryPieChart data={productSlices} emptyMessage="No items yet." />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
