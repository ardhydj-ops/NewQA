import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatIDR } from "@/lib/format";
import type { Tx } from "@/lib/dummy-data";

export function RecentTransactions({ data }: { data: Tx[] }) {
  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftar transaksi</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            Belum ada transaksi.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Tanggal</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead className="pr-6 text-right">Jumlah</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tx) => {
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
                        {isIncome ? "Income" : "Expense"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tx.category}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {tx.description ?? "—"}
                    </TableCell>
                    <TableCell
                      className={`pr-6 text-right text-sm font-medium tabular-nums ${
                        isIncome
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {isIncome ? "+" : "−"}
                      {formatIDR(tx.amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <Link
          href="/transactions"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Lihat semua →
        </Link>
      </CardFooter>
    </Card>
  );
}
