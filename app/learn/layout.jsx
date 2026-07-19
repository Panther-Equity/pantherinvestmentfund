import { createClient } from "@/utils/supabase/server";
import TopBar from "@/components/TopBar";

export default async function LearnLayout({ children }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (
    <>
      <TopBar
        name={profile?.full_name || user.email}
        email={user.email}
        role={profile?.role || "student"}
      />
      <div className="pe-wrap">{children}</div>
    </>
  );
}
