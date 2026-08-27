"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// @feature: admin-reset-link-v1 (2026-08-14)
// This page now handles two link types, so the copy is type-aware. An invite
// says "you've been invited"; a recovery link says "reset your password".
// Showing a member who forgot their password an "Accept invite" button reads
// like the wrong link and is a real reason someone would not click it.
//
// @feature: self-serve-invite-resend-v1 (2026-08-25)
// On an invite-link failure specifically, point at /invite/resend instead of
// dead-ending on "ask an admin." Not gated on the specific otp_expired error
// code - /api/verify-invite only forwards error.message today, not a code,
// and any invite-verification failure (expired, already used, malformed) is
// a reasonable prompt to request a fresh one rather than just the expiry
// case named in the original task.
//
// MERGED 2026-08-27 (PR #7 + #8, both touched this file). PR #7 added
// expired/invalid detection with copy written before either self-serve route
// existed ("ask an admin to hit Resend invite" / "Roster -> Reset"). By the
// time all three PRs are live, self-serve exists for both link types -
// /invite/resend (#9, already merged) and /forgot-password (#8, merging in
// this same pass) - so the copy below points at those instead of an admin
// action. #7's real contribution kept here is the "that's normal, links
// expire" framing, which holds regardless of which fix-it path it points to.
export default function ConfirmInviteClient({ token_hash, type, next }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isRecovery = type === "recovery";
  const isExpiredOrInvalid = /expired|invalid/i.test(error);

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
      {error && (
        <>
          <div className="notice error">
            {error}
            {isExpiredOrInvalid && (
              <div style={{ marginTop: 8 }}>
                {isRecovery
                  ? "That's normal — reset links expire."
                  : "That's normal — invite links expire."}
              </div>
            )}
          </div>
          <p>
            {isRecovery ? (
              <Link href="/forgot-password">Request a new reset link</Link>
            ) : (
              <Link href="/invite/resend">Request a new invite link</Link>
            )}
          </p>
        </>
      )}
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
