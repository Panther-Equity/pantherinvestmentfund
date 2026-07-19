import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export async function POST(request) {
  try {
    // Must be signed in (the invite link established a session via /auth/confirm).
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Your invite link has expired. Ask for a new one." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const password = String(body.password || "");
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Now that they've set a password, mark them active (best-effort).
    await admin.from("profiles").update({ status: "active" }).eq("id", user.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Could not set your password." }, { status: 500 });
  }
}
