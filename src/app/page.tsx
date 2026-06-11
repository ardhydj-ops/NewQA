import { StatCards } from "@/components/dashboard/stat-cards";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Get insights into your spending, track your expenses, and manage your
          finances.
        </p>
      </div>

      <StatCards />
    </div>
  );
}
