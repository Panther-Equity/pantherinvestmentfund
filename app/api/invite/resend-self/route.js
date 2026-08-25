import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";

// @feature: self-serve-invite-resend-v1 (2026-08-25)
//
// PR #7 (admin resend-invite) and its own code comment are explicit that
// true self-serve needs "Resend + a verified sending domain — no email
// sender exists in this app today." That's still accurate for the
// generic-email-API sense. But Supabase's own hosted mailer already sends
// real email automatically for one flow this app already ships: magic
// links via signInWithOtp, the exact mechanism PR #8 uses for password
// reset via resetPasswordForEmail. This route reuses that, not a new
// sender.
//
// Why not the two invite-shaped methods instead:
// - admin.generateLink({type:"invite"}) does NOT send an email — both
//   /api/invite and /api/resend-invite say so directly. It only returns a
//   link for a human to copy and send by hand.
// - admin.inviteUserByEmail DOES auto-send, but is documented to refuse an
//   already-invited, unconfirmed user (supabase/auth#2180) — the exact
//   wall /api/resend-invite was built to route around using generateLink
//   instead, at the cost of losing the auto-send.
//
// signInWithOtp has neither problem: Supabase sends the email itself, and
// it doesn't care whether the target has already been invited — it just
// authenticates whoever holds that inbox. shouldCreateUser:false stops it
// from creating a brand-new account for a typo'd or unknown address. The
// status==='invited' check below is what keeps this scoped to "resend an
// invite" rather than becoming an undocumented passwordless-login path for
// members who already have a password.
//
// Anti-enumeration: unlike /forgot-password, where Supabase's own
// documented behavior already returns success regardless of whether the
// address exists, our own profiles lookup here is the thing that could
// leak status if it were allowed to affect the response. So the response
// is hard-coded to {ok:true} in every case — unknown address, already-
// active member, genuinely-invited member, or an unexpected error. Only
// the invited case actually triggers a send.
//
// NOT VERIFIED END TO END. Built and reasoned against Supabase's current
// docs in this session; no local dev environment or real inbox available
// here to confirm delivery the way PR #7/#8 were confirmed last night.
// Test locally — enter a real @pitt.edu test address with status
// 'invited' and confirm a real email arrives — before merging.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const validFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!email || !validFormat || !email.endsWith("@pitt.edu")) {
      return NextResponse.json({ error: "Enter your @pitt.edu email address." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: target } = await admin
      .from("profiles")
      .select("status")
      .eq("email", email)
      .single();

    if (target?.status === "invited") {
      const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
      // Errors from this call (rate limit, etc.) are deliberately not
      // surfaced — see the anti-enumeration note above. A failed send here
      // is invisible to the requester, same tradeoff PR #8 already
      // accepted for /forgot-password.
      await anon.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${origin}/set-password`,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    // Same reasoning: an unexpected failure here still can't be allowed to
    // read differently from the normal "we don't know if that account
    // exists" response.
    return NextResponse.json({ ok: true });
  }
}
