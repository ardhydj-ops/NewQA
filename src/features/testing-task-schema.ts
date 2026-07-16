import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus format YYYY-MM-DD");

const nonNegativeInt = z
  .number()
  .int("Harus berupa bilangan bulat")
  .min(0, "Tidak boleh negatif");

/** Skema input untuk membuat/mengubah testing task. */
export const TestingTaskInput = z.object({
  title: z.string().trim().min(1, "Judul wajib diisi"),
  description: z.string().trim().optional(),
  status: z.enum(["not_started", "in_progress", "passed", "failed", "blocked"]),
  priority: z.enum(["low", "medium", "high"]),
  start_date: isoDate,
  due_date: isoDate.optional(),
  total_tc: nonNegativeInt,
  ok_count: nonNegativeInt,
  nok_count: nonNegativeInt,
  na_count: nonNegativeInt,
  total_execute_tc: nonNegativeInt,
  total_passed_tc: nonNegativeInt,
});

export type TestingTaskInput = z.infer<typeof TestingTaskInput>;
