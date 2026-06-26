"use client";

import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/components/i18n/language-provider";
import { LANGUAGE_LABELS, type Language } from "@/i18n/translations";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label={t("switcher.label")}>
          <Languages className="size-4" />
          <span className="hidden sm:inline">{LANGUAGE_LABELS[language]}</span>
          <span className="uppercase sm:hidden">{language}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(value) => setLanguage(value as Language)}
        >
          <DropdownMenuRadioItem value="id">
            {LANGUAGE_LABELS.id}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">
            {LANGUAGE_LABELS.en}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
