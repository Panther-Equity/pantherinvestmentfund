import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

// Entry point: send people where they belong based on their role.
export default async function Home() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "student";
  redirect(role === "student" ? "/learn" : "/admin");
}
