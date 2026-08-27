import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

// @feature: admin-resend-invite-v1 (2026-08-24)
// Regenerates a fresh invite link for someone already on the roster with
// status "invited" whose original link expired before they used it. Same
// shape as /api/invite and /api/reset-link: staff-only, generateLink, hand
// the raw link back for an admin to copy and send. No email sender exists
// yet (no Resend, no verified domain — see the Manual Supabase task and the
// reset-link route's own comment), so this cannot send automatically. It
// removes the "re-derive the mechanism by hand" step, not the "an admin
// sends it" step. True self-serve (the analyst types their own email and a
// message just arrives) needs Resend + a verified domain; that is separate,
// larger scope, not a prerequisite for this.
//
// CONFIRMED LOCALLY 2026-08-24: generateLink({type:"invite"}) succeeds when
// called again against an already-invited, still-unconfirmed user — it does
// NOT hit the "already registered" refusal that Supabase's inviteUserByEmail
// is documented to throw in that case (a still-open Supabase Auth issue,
// supabase/auth#2180). generateLink is a different code path, and this
// route's own error handling below (kept for defense in depth) never fired
// in testing — a fresh token_hash came back, the old one stopped verifying,
// and the new link carried through to /set-password correctly.
export async function POST(request) {
  try {
    // Caller must be signed in and staff (owner/admin) — same gate as
    // invite and reset-link.
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
      return NextResponse.json({ error: "Only admins can resend invites." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const userId = String(body.userId || "");
    if (!userId) {
      return NextResponse.json({ error: "Missing user." }, { status: 400 });
    }

    // Look the email up server-side from the id — same reasoning as
    // reset-link: don't trust a client-supplied address for anything that
    // mints a credential.
    const admin = createAdminClient();
    const { data: target } = await admin
      .from("profiles")
      .select("email, full_name, status")
      .eq("id", userId)
      .single();
    if (!target?.email) {
      return NextResponse.json({ error: "That person no longer exists." }, { status: 404 });
    }
    if (target.status !== "invited") {
      return NextResponse.json(
        { error: "This person has already set up their account — there's no invite to resend." },
        { status: 400 }
      );
    }

    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email: target.email,
      options: target.full_name ? { data: { full_name: target.full_name } } : undefined,
    });

    if (error) {
      // Not observed in testing (see note above) — kept as a clear signal
      // rather than a generic failure if Supabase's behavior ever changes.
      const msg = /registered|already exists|email_exists/i.test(error.message)
        ? "Supabase refused to regenerate a link for this address even though the account is still unconfirmed. This needs a different mechanism, not a retry."
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const hashed = data?.properties?.hashed_token;
    if (!hashed) {
      return NextResponse.json({ error: "Could not generate a new link. Try again." }, { status: 500 });
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const inviteLink = `${origin}/auth/confirm?token_hash=${hashed}&type=invite&next=/set-password`;

    return NextResponse.json({
      ok: true,
      email: target.email,
      name: target.full_name || target.email,
      inviteLink,
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Could not generate a new link." }, { status: 500 });
  }
}
