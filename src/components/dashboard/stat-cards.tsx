"use client";

import { useQuery } from "@tanstack/react-query";
import { PiggyBank, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getBalanceSummary } from "@/features/action";
import { formatIDR } from "@/lib/format";

type Item = {
  key: "savings" | "totalIncome" | "totalExpense";
  label: string;
  caption: string;
  icon: typeof PiggyBank;
  accent: string;
};

const items: Item[] = [
  {
    key: "savings",
    label: "Savings",
    caption: "Saving for all time",
    icon: PiggyBank,
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  {
    key: "totalIncome",
    label: "Incomes",
    caption: "Total Incomes for all time",
    icon: TrendingUp,
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  {
    key: "totalExpense",
    label: "Expenses",
    caption: "Total expenses for all time",
    icon: TrendingDown,
    accent: "text-emerald-600 dark:text-emerald-400",
  },
];

export function StatCards() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["balance-summary"],
    queryFn: getBalanceSummary,
  });

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map(({ key, label, caption, icon: Icon, accent }) => {
        const value = data?.[key] ?? 0;

        return (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle
                className={`flex items-center gap-2 text-sm font-medium ${accent}`}
              >
                <Icon className="size-4" />
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <>
                  <Skeleton className="h-9 w-44" />
                  <Skeleton className="mt-2 h-3 w-32" />
                </>
              ) : isError ? (
                <>
                  <div className="text-3xl font-bold tracking-tight">—</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Gagal memuat data
                  </p>
                </>
              ) : (
                <>
                  <div className="text-3xl font-bold tracking-tight tabular-nums">
                    {formatIDR(value)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
