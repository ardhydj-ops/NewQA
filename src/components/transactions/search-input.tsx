"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useTranslation } from "@/components/i18n/language-provider";

type SearchInputProps = {
  /** Dipanggil dengan nilai sudah di-trim, 300ms setelah ketikan berhenti. */
  onSearch: (value: string) => void;
  placeholder?: string;
};

export function SearchInput({ onSearch, placeholder }: SearchInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  // Simpan callback terbaru di ref agar efek debounce hanya bergantung pada `value`.
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  });

  // Debounce 300ms pakai setTimeout — tanpa package tambahan.
  useEffect(() => {
    const id = setTimeout(() => {
      onSearchRef.current(value.trim());
    }, 300);
    return () => clearTimeout(id);
  }, [value]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder ?? t("transactions.searchPlaceholder")}
        className="pl-9"
      />
    </div>
  );
}
