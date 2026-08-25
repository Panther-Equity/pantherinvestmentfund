import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Refreshes the Supabase session on every request and redirects
// signed-out visitors to /login (except public routes).
//
// @feature: self-serve-invite-resend-v1 (2026-08-25)
// Added /invite/resend, /api/invite/resend-self, and /set-password.
//
// /invite/resend and /api/invite/resend-self are the obvious ones - a page
// and route for people who are locked out have to be reachable while
// locked out.
//
// /set-password is here for the same reason PR #8 (still open, not yet
// merged as of this branch) already added it: this flow's email link uses
// signInWithOtp, which - like resetPasswordForEmail - lands the browser on
// the redirect target with the session in a URL fragment the server never
// sees, not a query param /auth/confirm can read. Without /set-password on
// this list, that request looks signed-out to this middleware and gets
// bounced to /login before the page's own client JS ever gets a chance to
// process the fragment.
//
// MERGE NOTE: PR #8 touches this same allowlist array independently (adds
// /forgot-password and /set-password). Whichever of these two PRs merges
// second will show a small textual conflict here - not a logic conflict,
// just two branches adding overlapping lines to the same list. Resolve by
// keeping the union of both.
export async function updateSession(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() must be called to refresh the token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/invite/resend") ||
    path.startsWith("/set-password") ||
    path === "/api/verify-invite" ||
    path === "/api/invite/resend-self";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
