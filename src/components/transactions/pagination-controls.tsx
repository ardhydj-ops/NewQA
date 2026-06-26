"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/components/i18n/language-provider";

type PaginationControlsProps = {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
};

export function PaginationControls({
  page,
  totalPages,
  onPrev,
  onNext,
}: PaginationControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={page <= 1}
      >
        <ChevronLeft className="size-4" />
        {t("pagination.prev")}
      </Button>

      <span className="text-sm text-muted-foreground tabular-nums">
        {t("pagination.pageOf", { page, total: totalPages })}
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={page >= totalPages}
      >
        {t("pagination.next")}
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
