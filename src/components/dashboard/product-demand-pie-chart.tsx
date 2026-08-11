"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

type ProductDemandPieChartProps = {
  data: { productId: string; hours: number }[];
  productNameById: Map<string, string>;
};

export function ProductDemandPieChart({ data, productNameById }: ProductDemandPieChartProps) {
  const top5 = data.slice(0, 5);
  const otherHours = data.slice(5).reduce((sum, d) => sum + d.hours, 0);

  const slices = [
    ...top5.map((d) => ({
      id: d.productId,
      name: productNameById.get(d.productId) ?? "—",
      hours: Math.round(d.hours * 100) / 100,
    })),
    ...(otherHours > 0 ? [{ id: "other", name: "Other", hours: Math.round(otherHours * 100) / 100 }] : []),
  ];

  if (slices.length === 0) {
    return <p className="text-sm text-muted-foreground">No allocated projects this week.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="hours" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
            {slices.map((slice, index) => (
              <Cell key={slice.id} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `${value} hrs`} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
