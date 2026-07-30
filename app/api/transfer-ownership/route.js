import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

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
