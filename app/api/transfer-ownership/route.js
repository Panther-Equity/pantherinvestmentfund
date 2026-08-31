import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

// SECURITY NOTE, added during the 2026-08-07 audit cleanup: the
// transfer_ownership() Postgres function verifies that current_owner names
// the real owner and new_owner is an active admin, but it does NOT verify
// that the CALLER is current_owner -- it trusts whatever id this route
// passes in. What actually keeps this safe is that EXECUTE on the function
// is granted only to postgres and service_role, not to anon or authenticated
// -- so the only path to calling it at all is this route, using the admin
// (service-role) client below, after the me.role !== "owner" check above.
//
// If that grant is ever widened to authenticated -- for some unrelated
// reason, by someone who doesn't know this -- any signed-in student could
// call transfer_ownership directly over PostgREST with an arbitrary
// current_owner/new_owner pair and demote the real owner. The check in this
// route would then be decorative. Do not widen that grant without adding
// caller verification inside the function itself first.

export async function POST(request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
    }

    const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!me || me.role !== "owner") {
      return NextResponse.json({ error: "Only the owner can transfer ownership." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const newOwnerId = String(body.newOwnerId || "");
    if (!newOwnerId) {
      return NextResponse.json({ error: "Missing the new owner." }, { status: 400 });
    }
    if (newOwnerId === user.id) {
      return NextResponse.json({ error: "You are already the owner." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: target } = await admin
      .from("profiles")
      .select("role, status, email, full_name")
      .eq("id", newOwnerId)
      .single();
    if (!target) {
      return NextResponse.json({ error: "That person no longer exists." }, { status: 404 });
    }
    if (target.status !== "active") {
      return NextResponse.json(
        { error: "The new owner must have accepted their invite (be active) first." },
        { status: 400 }
      );
    }
    if (target.role !== "admin") {
      return NextResponse.json({ error: "You can only transfer ownership to an admin." }, { status: 400 });
    }

    const { error } = await admin.rpc("transfer_ownership", {
      current_owner: user.id,
      new_owner: newOwnerId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, email: target.email, name: target.full_name || target.email });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Could not transfer ownership." }, { status: 500 });
  }
}
