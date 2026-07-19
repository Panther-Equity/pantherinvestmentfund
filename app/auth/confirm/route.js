import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Landing point for email links (invite, recovery, magic link). Verifies the
// token_hash, which sets the session cookies, then forwards to `next`.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") || "/";

  const fail = (reason) => {
    const url = new URL("/login", origin);
    url.searchParams.set("error", reason);
    return NextResponse.redirect(url);
  };

  if (!token_hash || !type) {
    return fail("This link is missing its token. Ask for a new invite.");
  }

  // Bind cookie writes to the redirect response so the session persists.
  const response = NextResponse.redirect(new URL(next, origin));
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
    return fail(error.message || "This link is invalid or has expired.");
  }

  return response;
}
