"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/components/i18n/language-provider";
import { QuickAddTransaction } from "@/components/quick-add-transaction";
import { PaginationControls } from "@/components/transactions/pagination-controls";
import { SearchInput } from "@/components/transactions/search-input";
import { TransactionFormDialog } from "@/components/transactions/transaction-form-dialog";
import { TransactionTable } from "@/components/transactions/transaction-table";
import { getTransactions } from "@/features/action";

const LIMIT = 10;

export default function TransactionsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  // Reset ke halaman 1 setiap kali kata kunci berubah.
  useEffect(() => {
    setPage(1);
  }, [search]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["transactions", { page, limit: LIMIT, search }],
    queryFn: () => getTransactions({ page, limit: LIMIT, search }),
  });

  const rows = data?.rows ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / LIMIT));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("transactions.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("transactions.subtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          {t("transactions.add")}
        </Button>
        <TransactionFormDialog
          mode="create"
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      </div>

      <SearchInput onSearch={setSearch} />

      <QuickAddTransaction />

      <TransactionTable rows={rows} isLoading={isLoading} isError={isError} />

      <PaginationControls
        page={page}
        totalPages={totalPages}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />
    </div>
  );
}
