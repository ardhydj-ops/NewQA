export type Tx = {
  id: string;
  date: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  description?: string;
};

export type DashboardSummary = {
  balance: number;
  monthIncome: number;
  monthExpense: number;
  weekly: { date: string; income: number; expense: number }[];
  recent: Tx[];
};

export const dummySummary: DashboardSummary = {
  balance: 12_400_000,
  monthIncome: 6_000_000,
  monthExpense: 2_100_000,
  weekly: [
    { date: "2026-06-05", income: 0, expense: 85_000 },
    { date: "2026-06-06", income: 0, expense: 240_000 },
    { date: "2026-06-07", income: 0, expense: 60_000 },
    { date: "2026-06-08", income: 1_500_000, expense: 175_000 },
    { date: "2026-06-09", income: 0, expense: 320_000 },
    { date: "2026-06-10", income: 0, expense: 95_000 },
    { date: "2026-06-11", income: 0, expense: 130_000 },
  ],
  recent: [
    { id: "t1",  date: "2026-06-11", type: "expense", amount:   130_000, category: "Food",       description: "Makan siang + kopi" },
    { id: "t2",  date: "2026-06-10", type: "expense", amount:    95_000, category: "Transport",  description: "Bensin" },
    { id: "t3",  date: "2026-06-09", type: "expense", amount:   320_000, category: "Bills",      description: "Internet bulanan" },
    { id: "t4",  date: "2026-06-08", type: "income",  amount: 1_500_000, category: "Freelance",  description: "Project landing page" },
    { id: "t5",  date: "2026-06-08", type: "expense", amount:   175_000, category: "Food",       description: "Belanja mingguan" },
    { id: "t6",  date: "2026-06-07", type: "expense", amount:    60_000, category: "Transport",  description: "Grab pulang kantor" },
    { id: "t7",  date: "2026-06-06", type: "expense", amount:   240_000, category: "Shopping",   description: "Sepatu lari" },
    { id: "t8",  date: "2026-06-05", type: "expense", amount:    85_000, category: "Food",       description: "Nongkrong kafe" },
    { id: "t9",  date: "2026-06-03", type: "income",  amount: 4_500_000, category: "Salary",     description: "Gaji bulanan" },
    { id: "t10", date: "2026-06-02", type: "expense", amount:   450_000, category: "Bills",      description: "Listrik + air" },
  ],
};
