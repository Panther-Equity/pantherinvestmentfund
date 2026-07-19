"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function SetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();

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
    <div className="login">
      <div className="loginbox">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Panther Equity" />
        <h1>Set your password</h1>

        {checking ? (
          <p>Checking your invite…</p>
        ) : !hasSession ? (
          <>
            <p>
              This invite link is invalid or has expired. Ask an admin to send you a new one.
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
              Welcome{email ? ` — ${email}` : ""}. Choose a password to finish setting up your account.
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
                {busy ? "Saving…" : "Set password & continue"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
