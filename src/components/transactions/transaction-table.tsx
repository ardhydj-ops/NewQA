"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TransactionFormDialog } from "@/components/transactions/transaction-form-dialog";
import { useTranslation } from "@/components/i18n/language-provider";
import { deleteTransaction } from "@/features/action";
import { formatDate, formatIDR } from "@/lib/format";
import type { Tx } from "@/lib/dummy-data";

type TransactionTableProps = {
  rows: Tx[];
  isLoading: boolean;
  isError: boolean;
};

export function TransactionTable({
  rows,
  isLoading,
  isError,
}: TransactionTableProps) {
  const { t } = useTranslation();
  // Baris yang sedang diedit (null = dialog edit tertutup).
  const [editingTx, setEditingTx] = useState<Tx | null>(null);
  // Baris yang akan dihapus (null = dialog konfirmasi tertutup).
  const [deletingTx, setDeletingTx] = useState<Tx | null>(null);

  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      toast.success(t("delete.toast"));
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["balance-summary"] });
      setDeletingTx(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("transactions.cardTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">{t("transactions.col.date")}</TableHead>
              <TableHead>{t("transactions.col.type")}</TableHead>
              <TableHead>{t("transactions.col.category")}</TableHead>
              <TableHead>{t("transactions.col.note")}</TableHead>
              <TableHead className="text-right">
                {t("transactions.col.amount")}
              </TableHead>
              <TableHead className="pr-6 text-right">
                {t("transactions.col.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-6">
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-4 w-20" />
                  </TableCell>
                  <TableCell className="pr-6">
                    <Skeleton className="ml-auto size-8 rounded-md" />
                  </TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {t("transactions.loadError")}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {t("transactions.empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((tx) => {
                const isIncome = tx.type === "income";
                return (
                  <TableRow key={tx.id}>
                    <TableCell className="pl-6 text-sm text-muted-foreground">
                      {formatDate(tx.date)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          isIncome
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
                        }
                      >
                        {isIncome
                          ? t("transactions.type.income")
                          : t("transactions.type.expense")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tx.category}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {tx.description ?? "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right text-sm font-medium tabular-nums ${
                        isIncome
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {isIncome ? "+" : "−"}
                      {formatIDR(tx.amount)}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t("transactions.action.aria")}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditingTx(tx)}>
                            <Pencil className="size-4" />
                            {t("transactions.action.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setDeletingTx(tx)}
                            className="text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-400"
                          >
                            <Trash2 className="size-4" />
                            {t("transactions.action.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Dialog edit — mount hanya saat ada baris yang diedit. `key` memastikan
          form remount dengan pre-fill baris yang benar saat ganti baris. */}
      {editingTx && (
        <TransactionFormDialog
          key={editingTx.id}
          mode="edit"
          open
          onOpenChange={(o) => {
            if (!o) setEditingTx(null);
          }}
          initialValue={editingTx}
        />
      )}

      {/* Konfirmasi hapus — wajib sebelum delete dieksekusi. */}
      <AlertDialog
        open={deletingTx !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingTx(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.desc", {
                name: deletingTx?.description || t("delete.noNote"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("delete.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                // Cegah dialog menutup sebelum mutation jalan; tutup di onSuccess.
                event.preventDefault();
                if (deletingTx) deleteMutation.mutate(deletingTx.id);
              }}
            >
              {deleteMutation.isPending
                ? t("delete.deleting")
                : t("delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
