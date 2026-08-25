"use client";

import { useState } from "react";
import Link from "next/link";

// @feature: self-serve-invite-resend-v1 (2026-08-25)
// True self-serve counterpart to the admin-only /api/resend-invite (PR #7).
// That route's own comment says this piece is explicitly out of scope: "no
// email sender exists in this app today." Still true in the sense that
// there's no Resend account or verified domain — but the actual send here
// goes through Supabase's own hosted mailer via signInWithOtp, the same
// mechanism PR #8 already proved out for password reset. See
// app/api/invite/resend-self/route.js for why that path works here and
// generateLink/inviteUserByEmail don't.
export default function ResendInvitePage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/invite/resend-self", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
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
        <h1>Get a new invite link</h1>

        {done ? (
          <>
            <p>
              If {email.trim()} has a pending invite, a fresh link is on its way. It can
              take a few minutes to arrive.
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
            <p>
              If your original invite link expired, enter your Pitt email and we&rsquo;ll
              send a new one.
            </p>
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
                {busy ? "Sending…" : "Send new link"}
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
