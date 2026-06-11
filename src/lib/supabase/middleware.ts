import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresh Supabase session cookies per request.
 *
 * Dipanggil dari `src/proxy.ts` (file convention Next.js 16 untuk
 * middleware). Wajib panggil `supabase.auth.getUser()` di sini agar
 * token yang expired otomatis di-refresh — kalau tidak, session bisa
 * "mati" walau cookie-nya masih ada.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // PENTING: Jangan hapus baris ini. `getUser()` memicu refresh token
  // & sinkronisasi cookie response. Tanpa ini, session lambat-laun
  // jadi inkonsisten antara browser & server.
  await supabase.auth.getUser();

  return supabaseResponse;
}
