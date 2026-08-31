import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export async function POST(request) {
  try {
    // Caller must be signed in and staff.
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
    }
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      return NextResponse.json({ error: "Only admins can remove people." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const userId = String(body.userId || "");
    if (!userId) {
      return NextResponse.json({ error: "Missing user." }, { status: 400 });
    }
    if (userId === user.id) {
      return NextResponse.json({ error: "You can't remove yourself." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: target } = await admin
      .from("profiles")
      .select("role, email, full_name")
      .eq("id", userId)
      .single();
    if (!target) {
      return NextResponse.json({ error: "That person no longer exists." }, { status: 404 });
    }
    if (target.role === "owner") {
      return NextResponse.json({ error: "You can't remove the owner account." }, { status: 400 });
    }
    // @feature: admin-delete-owner-only-v1 (2026-08-31) -- HIGH-9. Role
    // editing was already owner-only ("owner writes profiles" RLS policy);
    // role *removal* wasn't, so any admin could delete another admin and
    // cascade away their enrollments/completions/scores. Matches the
    // existing pattern rather than introducing a new one.
    if (target.role === "admin" && me.role !== "owner") {
      return NextResponse.json({ error: "Only the owner can remove an admin." }, { status: 403 });
    }

    // Clear references that don't cascade, so the delete isn't blocked.
    await admin.from("bootcamps").update({ created_by: null }).eq("created_by", userId);
    await admin.from("enrollments").update({ assigned_by: null }).eq("assigned_by", userId);

    // Delete the auth user. Cascades: profile -> their enrollments -> completions + quiz_scores.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, email: target.email, name: target.full_name || target.email });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Could not remove the person." }, { status: 500 });
  }
}
