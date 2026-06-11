"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

async function pingSupabase() {
  const supabase = createClient();
  const { count, error } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true });

  if (error) throw error;
  return count ?? 0;
}

export function ConnectionTest() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["supabase-ping"],
    queryFn: pingSupabase,
  });

  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        {isLoading ? (
          <>
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Menghubungi Supabase…
            </span>
          </>
        ) : isError ? (
          <>
            <XCircle className="size-5 text-rose-600 dark:text-rose-400" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-rose-600 dark:text-rose-400">
                Koneksi gagal
              </span>
              <span className="text-xs text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </span>
            </div>
          </>
        ) : (
          <>
            <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Terhubung ke Supabase
              </span>
              <span className="text-xs text-muted-foreground">
                {data} transaksi di database
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
