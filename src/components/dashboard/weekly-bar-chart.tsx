"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDate } from "@/lib/format";

type Point = { date: string; income: number; expense: number };

const config = {
  income: { label: "Income", color: "var(--chart-1)" },
  expense: { label: "Expense", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function WeeklyBarChart({
  data,
  className,
}: {
  data: Point[];
  className?: string;
}) {
  const points = (data ?? []).map((p) => ({
    ...p,
    label: formatDate(p.date),
  }));

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>7 hari terakhir</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-64 w-full">
          <BarChart data={points} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="income" fill="var(--color-income)" radius={4} />
            <Bar dataKey="expense" fill="var(--color-expense)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
