import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Refreshes the Supabase session on every request and redirects
// signed-out visitors to /login (except public routes).
//
// @feature: self-serve-password-reset-v1 (2026-08-24)
// Added /forgot-password and /set-password to the public allowlist.
//
// /forgot-password is the obvious miss — a page for people who are locked
// out has to be reachable while locked out, and it simply wasn't on the
// list, so every request to it redirected to /login before the page ever
// rendered. Caught immediately in local testing (the link did nothing).
//
// /set-password is the less obvious one, and would have failed silently on
// the first real email test if it hadn't been caught here first. The
// existing invite and admin-reset-link flows already land here without a
// session-cookie problem, but only because they establish the session via a
// fetch() call first and THEN navigate client-side with router.push() — the
// cookie already exists by the time this middleware sees the request. The
// self-serve reset flow can't do that: Supabase's own server 302s the
// browser straight to /set-password?mode=reset as a real top-level
// navigation, with the session sitting unprocessed in a URL fragment the
// server never even sees. At that exact moment there is no session cookie
// yet — the client JS that would process the fragment hasn't loaded.
// Without this page on the allowlist, every one of those redirects would
// die here, silently, before ever reaching the page's own "no session"
// handling (which already exists and already renders the right fallback
// copy — this just lets it actually run).
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
    path.startsWith("/forgot-password") ||
    path.startsWith("/set-password") ||
    path === "/api/verify-invite";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
