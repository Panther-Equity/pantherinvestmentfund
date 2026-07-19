import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export async function POST(request) {
  try {
    // Caller must be signed in and staff (owner/admin).
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
      return NextResponse.json({ error: "Only admins can invite people." }, { status: 403 });
    }

    // Validate input.
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const full_name = String(body.full_name || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    // Create the user + generate an invite token (does NOT send an email).
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: full_name ? { data: { full_name } } : undefined,
    });

    if (error) {
      const msg = /registered|already exists|email_exists/i.test(error.message)
        ? "That email already has an account."
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const hashed = data?.properties?.hashed_token;
    if (!hashed) {
      return NextResponse.json({ error: "Could not generate an invite link. Try again." }, { status: 500 });
    }

    // Build our own link pointing at /auth/confirm (reliable token verification).
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const inviteLink = `${origin}/auth/confirm?token_hash=${hashed}&type=invite&next=/set-password`;

    // Mark them "invited" until they set a password (best-effort).
    if (data?.user?.id) {
      await admin.from("profiles").update({ status: "invited" }).eq("id", data.user.id);
    }

    return NextResponse.json({ ok: true, email, inviteLink });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Could not create the invite." }, { status: 500 });
  }
}
