"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConfirmInviteClient({ token_hash, type, next }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/verify-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_hash, type }),
      });
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Server returned non-JSON (status ${res.status}): ${raw.slice(0, 300)}`);
      }
      if (!res.ok) throw new Error(data.error || "This link is invalid or has expired.");
      router.push(next);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!token_hash || !type) {
    return <p>This link is missing its token. Ask an admin for a new invite.</p>;
  }

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", textAlign: "center" }}>
      {error && <div className="notice error">{error}</div>}
      <p>You&rsquo;ve been invited to join the Panther Equity Training Portal.</p>
      <button className="btn pri" type="button" onClick={accept} disabled={busy}>
        {busy ? "Confirming…" : "Accept invite"}
      </button>
    </div>
  );
}
