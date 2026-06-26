"use server";

import { createClient } from "@/lib/supabase/server";
import { TransactionInput } from "@/features/schema";
import type { Tx } from "@/lib/dummy-data";

type DbClient = Awaited<ReturnType<typeof createClient>>;

const SAVINGS_MINUS_MESSAGE =
  "Gagal input data: transaksi ini membuat savings menjadi minus.";

// Savings saat ini = total income - total expense.
async function getCurrentSavings(supabase: DbClient): Promise<number> {
  const { data } = await supabase.from("transactions").select("amount, type");
  let income = 0;
  let expense = 0;
  for (const tx of data ?? []) {
    if (tx.type === "income") income += tx.amount;
    else if (tx.type === "expense") expense += tx.amount;
  }
  return income - expense;
}

// Pengaruh sebuah transaksi terhadap savings: income menambah, expense mengurangi.
function savingsDelta(type: string, amount: number): number {
  return type === "income" ? amount : -amount;
}

/**
 * Hapus transaksi berdasarkan ID.
 *
 * @param id - ID transaksi yang dihapus.
 * @throws Jika delete database error.
 */
export async function deleteTransaction(id: string) {
  const supabase = await createClient();

  const { error } = await supabase.from("transactions").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * Buat transaksi baru. Input divalidasi dengan Zod sebelum insert.
 *
 * @param input - Data transaksi mentah (akan divalidasi TransactionInput).
 * @throws Jika validasi gagal atau insert ke database error.
 */
export async function createTransaction(input: unknown) {
  const parsed = TransactionInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Input tidak valid");
  }

  const supabase = await createClient();

  // Tolak jika transaksi ini membuat savings jadi minus.
  const projected =
    (await getCurrentSavings(supabase)) +
    savingsDelta(parsed.data.type, parsed.data.amount);
  if (projected < 0) {
    throw new Error(SAVINGS_MINUS_MESSAGE);
  }

  const { error } = await supabase.from("transactions").insert({
    type: parsed.data.type,
    category: parsed.data.category,
    amount: parsed.data.amount,
    description: parsed.data.description ?? null,
    date: parsed.data.date,
  });

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * Perbarui transaksi yang sudah ada. Input divalidasi dengan Zod.
 *
 * @param id    - ID transaksi yang diperbarui.
 * @param input - Data transaksi mentah (akan divalidasi TransactionInput).
 * @throws Jika validasi gagal atau update database error.
 */
export async function updateTransaction(id: string, input: unknown) {
  const parsed = TransactionInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Input tidak valid");
  }

  const supabase = await createClient();

  // Hitung savings seandainya transaksi ini diganti dengan nilai baru.
  // (savings sekarang sudah memasukkan nilai lama, jadi nilai lama dikeluarkan dulu.)
  const { data: existing } = await supabase
    .from("transactions")
    .select("amount, type")
    .eq("id", id)
    .single();
  const currentSavings = await getCurrentSavings(supabase);
  const oldDelta = existing
    ? savingsDelta(existing.type, existing.amount)
    : 0;
  const newDelta = savingsDelta(parsed.data.type, parsed.data.amount);
  if (currentSavings - oldDelta + newDelta < 0) {
    throw new Error(SAVINGS_MINUS_MESSAGE);
  }

  const { error } = await supabase
    .from("transactions")
    .update({
      type: parsed.data.type,
      category: parsed.data.category,
      amount: parsed.data.amount,
      description: parsed.data.description ?? null,
      date: parsed.data.date,
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}

/**
 * Ambil daftar transaksi dengan pagination + search opsional.
 * Urutan: tanggal desc, lalu created_at desc (tie-breaker untuk tanggal sama).
 *
 * @param page   - Nomor halaman (1-based). Default 1.
 * @param limit  - Jumlah baris per halaman. Default 10.
 * @param search - Kata kunci; mencocokkan description ATAU category (ilike,
 *                 case-insensitive, partial). Kosong = tanpa filter.
 * @returns `{ rows, totalCount }` — baris halaman ini + total (setelah filter).
 */
export async function getTransactions({
  page = 1,
  limit = 10,
  search = "",
}: { page?: number; limit?: number; search?: string } = {}): Promise<{
  rows: Tx[];
  totalCount: number;
}> {
  const supabase = await createClient();

  // .range(from, to) inklusif di kedua ujung — lihat dokumentasi Supabase.
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("transactions")
    .select("id, date, type, amount, category, description", { count: "exact" });

  // Filter hanya saat ada kata kunci — kosong = tampilkan semua.
  const term = search.trim();
  if (term) {
    query = query.or(
      `description.ilike.%${term}%,category.ilike.%${term}%`,
    );
  }

  const { data, count } = await query
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  return { rows: (data ?? []) as Tx[], totalCount: count ?? 0 };
}

export async function getBalanceSummary() {
  const supabase = await createClient();

  const { data } = await supabase.from("transactions").select("amount, type");

  const { totalIncome, totalExpense, savings } = (data || []).reduce(
    (acc, tx) => {
      if (tx.type === "income") acc.totalIncome += tx.amount;
      else if (tx.type === "expense") acc.totalExpense += tx.amount;
      acc.savings = acc.totalIncome - acc.totalExpense;
      return acc;
    },
    {
      totalIncome: 0,
      totalExpense: 0,
      savings: 0,
    },
  );

  return {
    totalIncome,
    totalExpense,
    savings,
  };
}
