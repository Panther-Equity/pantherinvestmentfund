import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export async function POST(request) {
  const { token_hash, type } = await request.json().catch(() => ({}));
  if (!token_hash || !type) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) {
    return NextResponse.json(
      { error: error.message || "This link is invalid or has expired." },
      { status: 400 }
    );
  }
  return response;
}
