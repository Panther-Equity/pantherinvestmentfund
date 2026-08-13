import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import TopBar from "@/components/TopBar";
import AdminTabs from "@/components/admin/AdminTabs";

export default async function AdminLayout({ children }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Only staff (admin / owner) may see the console.
  if (!profile || profile.role === "student") redirect("/learn");

  return (
    <>
      <TopBar name={profile.full_name || user.email} email={user.email} role={profile.role} />
      <div className="pe-wrap">
        <AdminTabs />
        {children}
      </div>
    </>
  );
}
