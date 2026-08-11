"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

type TopUtilizedQaChartProps = {
  data: { id: string; name: string; loadPercent: number }[];
};

export function TopUtilizedQaChart({ data }: TopUtilizedQaChartProps) {
  const top10 = [...data].sort((a, b) => b.loadPercent - a.loadPercent).slice(0, 10);

  if (top10.length === 0) {
    return <p className="text-sm text-muted-foreground">No allocated QAs this week.</p>;
  }

  return (
    <div style={{ height: Math.max(160, top10.length * 32) }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={top10} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" unit="%" domain={[0, (max: number) => Math.max(100, Math.ceil(max))]} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value) => `${Math.round(Number(value) * 2) / 2}%`} />
          <Bar dataKey="loadPercent" radius={[0, 4, 4, 0]}>
            {top10.map((row, index) => (
              <Cell key={row.id} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
