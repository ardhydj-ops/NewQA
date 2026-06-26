"use client";

import { useQuery } from "@tanstack/react-query";
import { Frown, Meh, Smile } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/components/i18n/language-provider";
import { getBalanceSummary } from "@/features/action";
import type { TranslationKey } from "@/i18n/translations";

type Level = "happy" | "flat" | "sad";

/**
 * Tentukan level pencapaian dari rasio expense terhadap income.
 * - > 75%        → "sad"   (pengeluaran tinggi)
 * - 25% s/d 75%  → "flat"  (cukup seimbang)
 * - < 25%        → "happy" (terkendali)
 *
 * Jika income 0: ada expense → "sad", tanpa expense → "happy".
 */
function levelFromRatio(totalIncome: number, totalExpense: number): Level {
  const ratio =
    totalIncome > 0
      ? totalExpense / totalIncome
      : totalExpense > 0
        ? Infinity
        : 0;

  if (ratio > 0.75) return "sad";
  if (ratio >= 0.25) return "flat";
  return "happy";
}

const LEVELS: Record<
  Level,
  { titleKey: TranslationKey; captionKey: TranslationKey; avatar: string }
> = {
  happy: {
    titleKey: "achievement.happy.title",
    captionKey: "achievement.happy.caption",
    avatar:
      "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400",
  },
  flat: {
    titleKey: "achievement.flat.title",
    captionKey: "achievement.flat.caption",
    avatar:
      "bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400",
  },
  sad: {
    titleKey: "achievement.sad.title",
    captionKey: "achievement.sad.caption",
    avatar:
      "bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400",
  },
};

export function AchievementAvatar() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["balance-summary"],
    queryFn: getBalanceSummary,
  });

  const level: Level | null = data
    ? levelFromRatio(data.totalIncome, data.totalExpense)
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t("achievement.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 shrink-0 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        ) : isError || level === null ? (
          <p className="text-sm text-muted-foreground">
            {t("achievement.loadError")}
          </p>
        ) : (
          <div className="flex items-center gap-4">
            <div
              className={`flex size-14 shrink-0 items-center justify-center rounded-full ${LEVELS[level].avatar}`}
            >
              {level === "happy" && <Smile className="size-8" />}
              {level === "flat" && <Meh className="size-8" />}
              {level === "sad" && <Frown className="size-8" />}
            </div>
            <div>
              <p className="font-semibold">{t(LEVELS[level].titleKey)}</p>
              <p className="text-sm text-muted-foreground">
                {t(LEVELS[level].captionKey)}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
