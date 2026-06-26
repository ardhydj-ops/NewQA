import { z } from "zod";

/** Skema input untuk membuat transaksi baru. */
export const TransactionInput = z.object({
  type: z.enum(["income", "expense"]),
  category: z.string().trim().min(1, "Kategori wajib diisi"),
  amount: z.number().positive("Jumlah harus lebih dari 0"),
  description: z.string().trim().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus format YYYY-MM-DD"),
});

export type TransactionInput = z.infer<typeof TransactionInput>;
