"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickAddTransaction } from "@/features/quick-add";

function SubmitButton() {
  // useFormStatus membaca status submit dari <form> terdekat di atasnya.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Menambahkan..." : "Tambah"}
    </Button>
  );
}

export function QuickAddTransaction() {
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();

  async function action(formData: FormData) {
    const result = await quickAddTransaction(formData);
    if (result.ok) {
      formRef.current?.reset();
      // Refresh tabel transaksi + ringkasan dashboard.
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["balance-summary"] });
    } else {
      alert(result.error);
    }
  }

  return (
    <form ref={formRef} action={action} className="flex items-center gap-2">
      <Input
        type="text"
        name="text"
        placeholder={`Contoh: "ngopi 5000" atau "gaji 5000000"`}
        className="flex-1"
        autoComplete="off"
      />
      <SubmitButton />
    </form>
  );
}
