"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function LearnHome() {
  const supabase = createClient();
  const router = useRouter();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: enr } = await supabase
        .from("enrollments")
        .select("id, bootcamp_id, deadline, bootcamps(name, audience)")
        .eq("user_id", user.id);
      const { data: prog } = await supabase
        .from("enrollment_progress")
        .select("enrollment_id, pct")
        .eq("user_id", user.id);
      const pmap = Object.fromEntries((prog || []).map((p) => [p.enrollment_id, p.pct]));
      setRows((enr || []).map((e) => ({ ...e, pct: pmap[e.id] ?? 0 })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (rows === null) return <div className="stub">Loading your bootcamps…</div>;

  return (
    <>
      <div className="eyebrow">My training</div>
      <h1 className="h1">Your bootcamps</h1>
      <div className="sub">Work through each at your own pace — your progress saves automatically.</div>

      {rows.length === 0 ? (
        <div className="stub">
          No bootcamps assigned yet. Once an admin assigns you one, it&apos;ll show up here.
        </div>
      ) : (
        <div className="grid cards" style={{ marginTop: 18 }}>
          {rows.map((e) => (
            <div
              className="card learn-card"
              key={e.id}
              onClick={() => router.push(`/learn/${e.bootcamp_id}`)}
            >
              {e.bootcamps?.audience ? <span className="badge b-aud">{e.bootcamps.audience}</span> : null}
              <h3 style={{ margin: "12px 0 12px" }}>{e.bootcamps?.name}</h3>
              <div className="pbar">
                <div className="pbar-fill" style={{ width: `${e.pct}%` }} />
              </div>
              <div className="note" style={{ marginTop: 8 }}>
                {e.pct}% complete{e.deadline ? ` · due ${e.deadline}` : ""}
              </div>
              <div className="hr" />
              <button className="btn pri sm">{e.pct > 0 ? "Continue" : "Start"} →</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
