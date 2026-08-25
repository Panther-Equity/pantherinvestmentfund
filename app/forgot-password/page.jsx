"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

// @feature: self-serve-password-reset-v1 (2026-08-24, corrected same day)
// Self-serve counterpart to the admin-triggered /api/reset-link flow. Uses
// Supabase's own resetPasswordForEmail — built for exactly this, and unlike
// the invite-resend case, documented to work on existing users with no
// "already registered" gotcha. Supabase sends the email itself and, per its
// own docs, returns success with no email sent when the address doesn't
// exist — no custom enumeration-safety code needed here. An error from this
// call is never an "account doesn't exist" signal, only a real failure
// (rate limit, bad input), so it's safe to show as-is rather than masking it
// behind the generic message.
//
// CORRECTED: the first version of this file pointed redirectTo at
// /auth/confirm, which is the wrong destination for this flow specifically.
// /auth/confirm expects ?token_hash=&type= in the query string — the format
// the ADMIN-generated links use (app/api/reset-link, app/api/resend-invite),
// where nothing gets emailed and the app builds the link by hand. This route
// is different: Supabase's own default email template builds the link,
// verifies it server-side when clicked, and 302-redirects the browser with
// the session in a URL FRAGMENT (#access_token=...), never a query param.
// Sent to /auth/confirm, that page finds no token_hash and dead-ends on
// "this link is missing its token."
//
// The actual fix needs no template edit and no custom SMTP to function
// (SMTP still matters for the rate limit below, just not for correctness):
// point redirectTo at /set-password?mode=reset directly. That page already
// only checks supabase.auth.getUser() and doesn't care how the session got
// there — Supabase's browser client auto-detects a session from the URL
// fragment on load and writes it to the same cookies @supabase/ssr's server
// client reads. /set-password?mode=reset is exactly the page the admin
// reset-link flow already lands on, so nothing there needed to change either.
//
// SUPABASE DASHBOARD SETUP — done and verified 2026-08-24, not part of this
// diff since neither is code:
// 1. Authentication -> URL Configuration -> Site URL -> the real deployed
//    URL. GoTrue uses this as the base for the verify link it builds and as
//    a silent fallback if the redirect below isn't allow-listed.
// 2. Authentication -> URL Configuration -> Redirect URLs -> the deployed
//    origin. A DIFFERENT list from Site URL, previously empty — nothing in
//    this app had needed it before now, since every other link-sending
//    route builds its own URL by hand and never goes through GoTrue's
//    redirect-URL check at all. Miss this and Supabase silently redirects to
//    Site URL instead, no error raised.
// The email template itself stays on Supabase's default — this flow doesn't
// touch it.
//
// ALSO WORTH KNOWING: Supabase's default mailer (no custom SMTP) is rate-
// limited hard — commonly cited around 2 emails/hour project-wide, shared
// across every auth email type, not per recipient (including the
// resend-invite flow in the companion PR). This page can be fully correct
// and still have most requests go nowhere during a real traffic burst with
// no visible error, because the success message shows either way. Real
// capacity needs Resend + a verified domain — tracked separately, not a
// blocker for this to ship.
export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const origin = window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin}/set-password?mode=reset`,
      });
      if (error) throw error;
      setDone(true);
    } catch (e2) {
      setErr(e2?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="loginbox">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Panther Equity" />
        <h1>Reset your password</h1>

        {done ? (
          <>
            <p>
              If {email.trim()} has an account, a reset link is on its way. It expires in
              about 24 hours.
            </p>
            <Link
              className="btn pri block"
              href="/login"
              style={{ textDecoration: "none", textAlign: "center", display: "block" }}
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p>Enter your Pitt email and we&rsquo;ll send you a link to set a new password.</p>
            <form onSubmit={submit}>
              {err && <div className="notice error">{err}</div>}
              <input
                className="input"
                type="email"
                placeholder="you@pitt.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button className="btn pri block" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <div className="toggle">
              <Link href="/login">Back to sign in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
