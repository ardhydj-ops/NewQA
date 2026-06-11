"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const isServer = typeof window === "undefined";

/**
 * Pola standar TanStack Query untuk Next.js App Router.
 *
 * Kenapa pattern aneh begini?
 * - Di SERVER: tiap request harus dapat QueryClient baru.
 *   Kalau dishare antar request, cache user A bisa bocor ke user B.
 * - Di BROWSER: cukup satu QueryClient global selama sesi tab.
 *   Bikin baru tiap render → cache hilang setiap re-render.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data dianggap fresh selama 1 menit — di interval ini tidak
        // refetch otomatis saat komponen mount ulang.
        staleTime: 60 * 1000,
        // Jangan auto-retry untuk error 4xx (data benar-benar
        // bermasalah, retry tidak akan bantu).
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (isServer) {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  );
}
