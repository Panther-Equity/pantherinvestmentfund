import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

// @feature: admin-reset-link-v1 (2026-08-14)
// CRIT-5 (interim). There was no password reset path at all — not self-service,
// not admin-side — so a member who forgot their password had no route back in
// short of an admin deleting and re-inviting them, which destroys their
// enrollments and progress.
//
// Deliberately mirrors app/api/invite: same staff-only gate, same
// generateLink + copy-the-link-by-hand pattern, no new infrastructure. Full
// self-service reset needs a transactional email sender (Resend) and a verified
// sending domain; neither exists yet, and neither is a prerequisite for giving
// admins a way to unstick somebody today.
//
// generateLink type "recovery" produces a token that /api/verify-invite already
// accepts without modification — that route passes whatever `type` it is given
// straight to verifyOtp — so the link lands on /auth/confirm and then
// /set-password exactly like an invite does. One verification path, one
// password-setting page, two link types.
export async function POST(request) {
  try {
    // Caller must be signed in and staff (owner/admin) — same gate as invite.
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
    }
    const { data: me } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      return NextResponse.json(
        { error: "Only admins can generate reset links." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const userId = String(body.userId || "");
    if (!userId) {
      return NextResponse.json({ error: "Missing user." }, { status: 400 });
    }

    // Look the email up server-side from the id rather than trusting an email
    // sent by the client. A reset link is a credential: accepting a
    // caller-supplied address would let any admin mint one for an arbitrary
    // address, including one not on the roster.
    const admin = createAdminClient();
    const { data: target } = await admin
      .from("profiles")
      .select("email, full_name, status")
      .eq("id", userId)
      .single();
    if (!target?.email) {
      return NextResponse.json({ error: "That person no longer exists." }, { status: 404 });
    }

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: target.email,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const hashed = data?.properties?.hashed_token;
    if (!hashed) {
      return NextResponse.json(
        { error: "Could not generate a reset link. Try again." },
        { status: 500 }
      );
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    // `next` carries a mode flag so /set-password can say "reset your password"
    // instead of "finish setting up your account". It is percent-encoded because
    // it is a query-parameter value that itself contains a query string; leaving
    // the inner `?` raw would depend on how the parser treats a second `?`.
    const next = encodeURIComponent("/set-password?mode=reset");
    const resetLink = `${origin}/auth/confirm?token_hash=${hashed}&type=recovery&next=${next}`;

    // Status is deliberately NOT touched. An active member stays active, and a
    // still-invited member stays invited until they actually set a password —
    // /api/set-password is what flips status to active, and it already does.
    return NextResponse.json({
      ok: true,
      email: target.email,
      name: target.full_name || target.email,
      resetLink,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e?.message || "Could not create the reset link." },
      { status: 500 }
    );
  }
}
