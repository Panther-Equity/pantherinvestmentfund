"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("error");
    if (e) setError(e);
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="loginbox">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Panther Equity" />
        <h1>Panther Equity Training Portal</h1>
        <p>Sign in with your Pitt email to continue.</p>

        <form onSubmit={submit}>
          {error && <div className="notice error">{error}</div>}
          <input
            className="input"
            type="email"
            placeholder="you@pitt.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="btn pri block" type="submit" disabled={busy}>
            {busy ? "Please wait…" : "Sign in"}
          </button>
        </form>

        {/* @feature: self-serve-invite-resend-v1 (2026-08-25) */}
        <div className="toggle">
          <Link href="/invite/resend">Trouble with your invite link?</Link>
        </div>

        <div className="toggle">Accounts are invite-only — ask an admin for an invite link.</div>
      </div>
    </div>
  );
}
