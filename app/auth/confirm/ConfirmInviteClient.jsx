"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// @feature: admin-reset-link-v1 (2026-08-14)
// This page now handles two link types, so the copy is type-aware. An invite
// says "you've been invited"; a recovery link says "reset your password".
// Showing a member who forgot their password an "Accept invite" button reads
// like the wrong link and is a real reason someone would not click it.
export default function ConfirmInviteClient({ token_hash, type, next }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isRecovery = type === "recovery";

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
    return (
      <p>
        This link is missing its token. Ask an admin for a new one.
      </p>
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", textAlign: "center" }}>
      {error && <div className="notice error">{error}</div>}
      <p>
        {isRecovery
          ? "Confirm to reset your Panther Equity Training Portal password."
          : "You\u2019ve been invited to join the Panther Equity Training Portal."}
      </p>
      <button className="btn pri" type="button" onClick={accept} disabled={busy}>
        {busy ? "Confirming\u2026" : isRecovery ? "Reset my password" : "Accept invite"}
      </button>
    </div>
  );
}
