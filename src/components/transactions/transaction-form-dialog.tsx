"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/components/i18n/language-provider";
import { createTransaction, updateTransaction } from "@/features/action";
import type { Tx } from "@/lib/dummy-data";

type FormState = {
  type: "income" | "expense";
  category: string;
  amount: string;
  description: string;
  date: string;
};

type SubmitPayload = {
  type: "income" | "expense";
  category: string;
  amount: number;
  description?: string;
  date: string;
};

type TransactionFormDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wajib diisi saat mode "edit" — dipakai untuk pre-fill + target update. */
  initialValue?: Tx;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Bentuk state form dari sebuah transaksi (edit) atau default kosong (create).
function formFromTx(tx?: Tx): FormState {
  return tx
    ? {
        type: tx.type,
        category: tx.category,
        amount: String(tx.amount),
        description: tx.description ?? "",
        date: tx.date,
      }
    : {
        type: "expense",
        category: "",
        amount: "",
        description: "",
        date: todayISO(),
      };
}

export function TransactionFormDialog({
  mode,
  open,
  onOpenChange,
  initialValue,
}: TransactionFormDialogProps) {
  const { t } = useTranslation();
  const isEdit = mode === "edit";

  // Pre-fill dari initialValue (edit) — parent disarankan memberi `key` per row
  // agar komponen remount dengan state awal yang benar saat ganti baris.
  const [form, setForm] = useState<FormState>(() => formFromTx(initialValue));

  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: SubmitPayload) =>
      isEdit && initialValue
        ? updateTransaction(initialValue.id, payload)
        : createTransaction(payload),
    onSuccess: () => {
      toast.success(isEdit ? t("form.toast.updated") : t("form.toast.created"));
      // Refresh tabel transaksi + ringkasan dashboard.
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["balance-summary"] });
      if (!isEdit) setForm(formFromTx());
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    mutation.mutate({
      type: form.type,
      category: form.category,
      // amount dikirim sebagai number; Zod di server menolak <= 0 / NaN.
      amount: Number(form.amount),
      description: form.description.trim() || undefined,
      date: form.date,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("form.edit.title") : t("form.create.title")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t("form.edit.desc") : t("form.create.desc")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="type">{t("form.label.type")}</Label>
            <Select
              value={form.type}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, type: value as FormState["type"] }))
              }
            >
              <SelectTrigger id="type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">{t("form.option.income")}</SelectItem>
                <SelectItem value="expense">
                  {t("form.option.expense")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">{t("form.label.category")}</Label>
            <Input
              id="category"
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({ ...f, category: e.target.value }))
              }
              placeholder={t("form.placeholder.category")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">{t("form.label.amount")}</Label>
            <Input
              id="amount"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value }))
              }
              placeholder="0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t("form.label.note")}</Label>
            <Input
              id="description"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder={t("form.placeholder.note")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">{t("form.label.date")}</Label>
            <Input
              id="date"
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? isEdit
                  ? t("form.submit.saving")
                  : t("form.submit.adding")
                : isEdit
                  ? t("form.submit.save")
                  : t("form.submit.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
