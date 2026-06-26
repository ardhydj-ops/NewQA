"use client";

import { AchievementAvatar } from "@/components/dashboard/achievement-avatar";
import { StatCards } from "@/components/dashboard/stat-cards";
import { useTranslation } from "@/components/i18n/language-provider";

export default function DashboardPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
          {t("dashboard.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("dashboard.subtitle")}
        </p>
      </div>

      <StatCards />

      <AchievementAvatar />
    </div>
  );
}
