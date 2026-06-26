export type Language = "id" | "en";

export const LANGUAGE_LABELS: Record<Language, string> = {
  id: "Indonesia",
  en: "English",
};

type Params = Record<string, string | number>;

// `en` adalah sumber kunci. `id` wajib memiliki kunci yang sama (dipaksa oleh tipe Dict).
const en = {
  "app.name": "Fina App",

  "nav.dashboard": "Dashboard",
  "nav.transactions": "Transactions",

  "switcher.label": "Language",

  "dashboard.title": "Dashboard",
  "dashboard.subtitle":
    "Get insights into your spending, track your expenses, and manage your finances.",

  "stat.savings.label": "Savings",
  "stat.savings.caption": "Saving for all time",
  "stat.income.label": "Incomes",
  "stat.income.caption": "Total incomes for all time",
  "stat.expense.label": "Expenses",
  "stat.expense.caption": "Total expenses for all time",
  "stat.loadError": "Failed to load data",

  "achievement.title": "Financial achievement",
  "achievement.loadError": "Failed to load achievement.",
  "achievement.happy.title": "Healthy finances",
  "achievement.happy.caption": "Expenses below 25% of income. Keep it up!",
  "achievement.flat.title": "Fairly balanced",
  "achievement.flat.caption": "Expenses 25–75% of income. Stay cautious.",
  "achievement.sad.title": "High spending",
  "achievement.sad.caption": "Expenses above 75% of income. Time to save.",

  "transactions.title": "Transactions",
  "transactions.subtitle": "Your latest transactions.",
  "transactions.add": "Add transaction",
  "transactions.cardTitle": "Transaction list",
  "transactions.searchPlaceholder": "Search description or category...",
  "transactions.col.date": "Date",
  "transactions.col.type": "Type",
  "transactions.col.category": "Category",
  "transactions.col.note": "Note",
  "transactions.col.amount": "Amount",
  "transactions.col.actions": "Actions",
  "transactions.type.income": "Income",
  "transactions.type.expense": "Expense",
  "transactions.empty": "No transactions yet.",
  "transactions.loadError": "Failed to load transactions.",
  "transactions.action.edit": "Edit",
  "transactions.action.delete": "Delete",
  "transactions.action.aria": "Transaction actions",

  "pagination.pageOf": "Page {page} of {total}",
  "pagination.prev": "Prev",
  "pagination.next": "Next",

  "form.create.title": "Add transaction",
  "form.edit.title": "Edit transaction",
  "form.create.desc": "Record a new income or expense.",
  "form.edit.desc": "Update this transaction's details.",
  "form.label.type": "Type",
  "form.label.category": "Category",
  "form.label.amount": "Amount",
  "form.label.note": "Note (optional)",
  "form.label.date": "Date",
  "form.option.income": "Income",
  "form.option.expense": "Expense",
  "form.placeholder.category": "e.g. Food, Salary",
  "form.placeholder.note": "e.g. Lunch",
  "form.submit.add": "Add",
  "form.submit.save": "Save",
  "form.submit.adding": "Adding...",
  "form.submit.saving": "Saving...",
  "form.toast.created": "Transaction added successfully.",
  "form.toast.updated": "Transaction updated successfully.",

  "delete.title": "Delete transaction?",
  "delete.desc":
    "Transaction '{name}' will be permanently deleted. This action cannot be undone.",
  "delete.noNote": "(no note)",
  "delete.cancel": "Cancel",
  "delete.confirm": "Delete",
  "delete.deleting": "Deleting...",
  "delete.toast": "Transaction deleted successfully.",
} satisfies Record<string, string>;

type Dict = typeof en;

const id: Dict = {
  "app.name": "Fina App",

  "nav.dashboard": "Dashboard",
  "nav.transactions": "Transaksi",

  "switcher.label": "Bahasa",

  "dashboard.title": "Dashboard",
  "dashboard.subtitle":
    "Dapatkan wawasan pengeluaran, lacak biaya Anda, dan kelola keuangan Anda.",

  "stat.savings.label": "Tabungan",
  "stat.savings.caption": "Tabungan sepanjang waktu",
  "stat.income.label": "Pemasukan",
  "stat.income.caption": "Total pemasukan sepanjang waktu",
  "stat.expense.label": "Pengeluaran",
  "stat.expense.caption": "Total pengeluaran sepanjang waktu",
  "stat.loadError": "Gagal memuat data",

  "achievement.title": "Pencapaian keuangan",
  "achievement.loadError": "Gagal memuat pencapaian.",
  "achievement.happy.title": "Keuangan sehat",
  "achievement.happy.caption":
    "Pengeluaran di bawah 25% dari pemasukan. Pertahankan!",
  "achievement.flat.title": "Cukup seimbang",
  "achievement.flat.caption":
    "Pengeluaran 25–75% dari pemasukan. Tetap waspada.",
  "achievement.sad.title": "Pengeluaran tinggi",
  "achievement.sad.caption":
    "Pengeluaran di atas 75% dari pemasukan. Saatnya berhemat.",

  "transactions.title": "Transaksi",
  "transactions.subtitle": "Daftar transaksi terbaru Anda.",
  "transactions.add": "Tambah transaksi",
  "transactions.cardTitle": "Daftar transaksi",
  "transactions.searchPlaceholder": "Cari deskripsi atau kategori...",
  "transactions.col.date": "Tanggal",
  "transactions.col.type": "Tipe",
  "transactions.col.category": "Kategori",
  "transactions.col.note": "Catatan",
  "transactions.col.amount": "Jumlah",
  "transactions.col.actions": "Aksi",
  "transactions.type.income": "Pemasukan",
  "transactions.type.expense": "Pengeluaran",
  "transactions.empty": "Belum ada transaksi.",
  "transactions.loadError": "Gagal memuat transaksi.",
  "transactions.action.edit": "Edit",
  "transactions.action.delete": "Hapus",
  "transactions.action.aria": "Aksi transaksi",

  "pagination.pageOf": "Halaman {page} dari {total}",
  "pagination.prev": "Sebelumnya",
  "pagination.next": "Berikutnya",

  "form.create.title": "Tambah transaksi",
  "form.edit.title": "Edit transaksi",
  "form.create.desc": "Catat pemasukan atau pengeluaran baru.",
  "form.edit.desc": "Perbarui detail transaksi ini.",
  "form.label.type": "Tipe",
  "form.label.category": "Kategori",
  "form.label.amount": "Jumlah",
  "form.label.note": "Catatan (opsional)",
  "form.label.date": "Tanggal",
  "form.option.income": "Pemasukan",
  "form.option.expense": "Pengeluaran",
  "form.placeholder.category": "mis. Food, Salary",
  "form.placeholder.note": "mis. Makan siang",
  "form.submit.add": "Tambah",
  "form.submit.save": "Simpan",
  "form.submit.adding": "Menambahkan...",
  "form.submit.saving": "Menyimpan...",
  "form.toast.created": "Transaksi berhasil ditambahkan.",
  "form.toast.updated": "Transaksi berhasil diperbarui.",

  "delete.title": "Hapus transaksi?",
  "delete.desc":
    "Transaksi '{name}' akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.",
  "delete.noNote": "(tanpa catatan)",
  "delete.cancel": "Batal",
  "delete.confirm": "Hapus",
  "delete.deleting": "Menghapus...",
  "delete.toast": "Transaksi berhasil dihapus.",
};

export const translations: Record<Language, Dict> = { en, id };

export type TranslationKey = keyof Dict;

/** Ambil string terjemahan + ganti placeholder `{name}` dengan params. */
export function translate(
  lang: Language,
  key: TranslationKey,
  params?: Params,
): string {
  let text: string = translations[lang][key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
