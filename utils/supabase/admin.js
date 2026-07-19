import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY admin client. Uses the service_role key, which bypasses Row
// Level Security. NEVER import this into a "use client" component or expose
// the key to the browser — it is only read inside Route Handlers (app/api/*).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing Supabase admin credentials. Add SUPABASE_SERVICE_ROLE_KEY to .env.local."
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
