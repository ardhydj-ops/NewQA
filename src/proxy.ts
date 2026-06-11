import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 Proxy (formerly Middleware).
 * Jalan di setiap request sebelum mencapai halaman/route handler.
 *
 * Tugas utama di sini: refresh session Supabase via cookies. Logika
 * detailnya dipindah ke `lib/supabase/middleware.ts` supaya file ini
 * tetap ringkas.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

/**
 * Matcher: jalankan proxy untuk semua request KECUALI asset statis
 * (gambar, font, _next internals, favicon). Ini mengurangi overhead
 * pada permintaan asset yang tidak butuh session refresh.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
