"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

// @feature: admin-reset-link-v1 (2026-08-14)
// This page serves both invites and admin-generated password resets. The
// recovery link carries ?mode=reset so the copy can match; without it a member
// resetting a forgotten password is told to "finish setting up your account",
// which reads like the wrong link. Reusing this page rather than adding a
// /reset-password twin keeps one page for one job — it already requires a
// session and already posts to /api/set-password, which is the whole flow.
//
// useSearchParams() forces a component into client-side rendering and Next 14
// fails `next build` if it is not wrapped in a Suspense boundary — caught by CI
// and by Vercel independently on PR #3. The form is therefore split out and the
// default export only supplies the boundary.
function SetPasswordForm() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isReset = searchParams.get("mode") === "reset";

  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setHasSession(!!user);
      setEmail(user?.email || "");
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not set your password.");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{isReset ? "Choose a new password" : "Set your password"}</h1>

      {checking ? (
        <p>{isReset ? "Checking your reset link\u2026" : "Checking your invite\u2026"}</p>
      ) : !hasSession ? (
        <>
          <p>
            {isReset
              ? "This reset link is invalid or has expired. Ask an admin for a new one."
              : "This invite link is invalid or has expired. Ask an admin to send you a new one."}
          </p>
          <div className="toggle">
            <button type="button" onClick={() => router.push("/login")}>
              Go to sign in
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {isReset
              ? `Choose a new password${email ? ` for ${email}` : ""}. Your progress and scores are unaffected.`
              : `Welcome${email ? ` — ${email}` : ""}. Choose a password to finish setting up your account.`}
          </p>
          <form onSubmit={submit}>
            {error && <div className="notice error">{error}</div>}
            <input
              className="input"
              type="password"
              placeholder="New password (8+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <button className="btn pri block" type="submit" disabled={busy}>
              {busy
                ? "Saving\u2026"
                : isReset
                ? "Save new password & continue"
                : "Set password & continue"}
            </button>
          </form>
        </>
      )}
    </>
  );
}

export default function SetPasswordPage() {
  return (
    <div className="login">
      <div className="loginbox">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Panther Equity" />
        <Suspense fallback={<p>Loading\u2026</p>}>
          <SetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
