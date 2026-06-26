"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { QUICK_ADD_SYSTEM } from "@/features/prompts";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CATEGORIES = [
  "Makanan & Minuman",
  "Transportasi",
  "Belanja",
  "Tagihan",
  "Hiburan",
  "Kesehatan",
  "Pendidikan",
  "Gaji & Pemasukan",
  "Lainnya",
];

const SAVE_TRANSACTION_TOOL: Anthropic.Tool = {
  name: "save_transaction",
  description:
    "Simpan satu transaksi keuangan hasil ekstraksi dari teks bebas user.",
  input_schema: {
    type: "object",
    properties: {
      amount: {
        type: "integer",
        description: "Nominal dalam Rupiah penuh tanpa titik, mis. 5000",
      },
      type: { type: "string", enum: ["income", "expense"] },
      category: { type: "string", enum: CATEGORIES },
      date: { type: "string", description: "Tanggal ISO format YYYY-MM-DD" },
      note: { type: "string", description: "Ringkasan singkat, maks 30 karakter" },
    },
    required: ["amount", "type", "category", "date", "note"],
    additionalProperties: false,
  },
};

type ParsedTransaction = {
  amount: number;
  type: "income" | "expense";
  category: string;
  date: string;
  note: string;
};

type QuickAddResult =
  | { ok: true; transaction: ParsedTransaction }
  | { ok: false; error: string };

/**
 * Parse teks bebas user (mis. "ngopi 5000") menjadi transaksi terstruktur
 * memakai Claude tool use. BELUM insert ke DB — hanya kembalikan hasil parse.
 */
export async function quickAddTransaction(
  formData: FormData,
): Promise<QuickAddResult> {
  const text = String(formData.get("text") ?? "").trim();
  if (!text) {
    return { ok: false, error: "Teks tidak boleh kosong." };
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      temperature: 0,
      system: QUICK_ADD_SYSTEM,
      tools: [SAVE_TRANSACTION_TOOL],
      tool_choice: { type: "tool", name: "save_transaction" },
      messages: [{ role: "user", content: `Hari ini: ${today}\n\n${text}` }],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return { ok: false, error: "Gagal mengekstrak transaksi dari teks." };
    }

    // tool_use.input sudah berupa object — JANGAN JSON.parse.
    const transaction = toolUse.input as ParsedTransaction;
    console.log("[quickAddTransaction] parsed:", transaction);

    // Insert ke Supabase (tanpa autentikasi / scoping user).
    const supabase = await createClient();
    const { error: insertError } = await supabase.from("transactions").insert({
      amount: transaction.amount,
      type: transaction.type,
      category: transaction.category,
      date: transaction.date,
      // Kolom tabel bernama `description` (bukan `note`); `note` hasil parse
      // disimpan ke sana agar muncul juga di kolom "Catatan" pada daftar.
      description: transaction.note,
    });
    if (insertError) {
      return { ok: false, error: insertError.message };
    }

    revalidatePath("/transactions");

    return { ok: true, transaction };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal memproses teks.",
    };
  }
}
