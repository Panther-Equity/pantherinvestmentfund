"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

function fmtDeadline(d) {
  if (!d) return null;
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function kindLabel(t) {
  return t === "knowledge_check" ? "Knowledge check" : t === "project_video" ? "Project" : "Video";
}

export default function LearnerDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState(null);
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);

    const { data: prof } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, status")
      .eq("id", id)
      .maybeSingle();
    if (!prof) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setProfile(prof);

    const { data: enr } = await supabase
      .from("enrollments")
      .select("id, bootcamp_id, cohort_id, deadline, bootcamps(name, audience), cohorts(name)")
      .eq("user_id", id);
    const enrollments = enr || [];

    const bootcampIds = [...new Set(enrollments.map((e) => e.bootcamp_id))];
    const enrollmentIds = enrollments.map((e) => e.id);

    let items = [],
      comps = [],
      scores = [],
      timeProg = []; // @feature: time-based-progress-v1
    if (bootcampIds.length) {
      const { data: its } = await supabase
        .from("items")
        .select("id, bootcamp_id, title, type, weight, position")
        .in("bootcamp_id", bootcampIds)
        .order("position");
      items = its || [];
    }
    if (enrollmentIds.length) {
      const [{ data: c }, { data: s }, { data: tp }] = await Promise.all([
        supabase.from("completions").select("enrollment_id, item_id").in("enrollment_id", enrollmentIds),
        supabase
          .from("quiz_scores")
          .select("enrollment_id, item_id, score, total")
          .in("enrollment_id", enrollmentIds),
        supabase
          .from("enrollment_time_progress") // @feature: time-based-progress-v1
          .select("enrollment_id, time_pct")
          .in("enrollment_id", enrollmentIds),
      ]);
      comps = c || [];
      scores = s || [];
      timeProg = tp || [];
    }

    const timePctMap = Object.fromEntries(timeProg.map((t) => [t.enrollment_id, t.time_pct])); // @feature: time-based-progress-v1

    const assembled = enrollments.map((e) => {
      const its = items.filter((i) => i.bootcamp_id === e.bootcamp_id);
      const compSet = new Set(comps.filter((c) => c.enrollment_id === e.id).map((c) => c.item_id));
      const scoreMap = Object.fromEntries(
        scores
          .filter((s) => s.enrollment_id === e.id)
          .map((s) => [s.item_id, { score: s.score, total: s.total }])
      );
      const totalW = its.reduce((sum, i) => sum + (i.weight || 1), 0);
      const doneW = its.filter((i) => compSet.has(i.id)).reduce((sum, i) => sum + (i.weight || 1), 0);
      const pct = totalW ? Math.round((100 * doneW) / totalW) : 0;
      const doneCount = its.filter((i) => compSet.has(i.id)).length;
      const rawTimePct = timePctMap[e.id]; // @feature: time-based-progress-v1
      return {
        id: e.id,
        bootcampName: e.bootcamps?.name || "—",
        audience: e.bootcamps?.audience || null,
        cohortName: e.cohorts?.name || null,
        deadline: e.deadline,
        pct,
        timePct: rawTimePct == null ? null : Math.round(rawTimePct), // @feature: time-based-progress-v1
        doneCount,
        total: its.length,
        items: its.map((i) => ({
          id: i.id,
          title: i.title,
          type: i.type,
          done: compSet.has(i.id),
          score: scoreMap[i.id] || null,
        })),
      };
    });
    assembled.sort(
      (a, b) =>
        (a.audience || "").localeCompare(b.audience || "") || a.bootcampName.localeCompare(b.bootcampName)
    );
    setRows(assembled);
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="stub">Loading…</div>;
  if (notFound)
    return (
      <>
        <button className="btn link" onClick={() => router.push("/admin/people")}>
          ← Back to roster
        </button>
        <div className="stub">That person couldn&rsquo;t be found.</div>
      </>
    );

  return (
    <>
      <button className="btn link" onClick={() => router.push("/admin/people")}>
        ← Back to roster
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "6px 0 4px" }}>
        <h1 className="h1" style={{ margin: 0 }}>
          {profile.full_name || profile.email}
        </h1>
        <span className={`pill ${profile.status === "invited" ? "pill-warn" : "pill-ok"}`}>
          {profile.status === "invited" ? "Invited" : "Active"}
        </span>
        <span className={`rolechip ${profile.role === "owner" ? "owner" : ""}`}>{profile.role}</span>
      </div>
      <div className="sub">{profile.email}</div>

      {rows.length === 0 ? (
        <div className="stub">
          Not enrolled in any bootcamps yet. Use the <strong>Assign</strong> tab to enroll them.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {rows.map((r) => (
            <div className="card" key={r.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  {r.audience ? <span className="badge b-aud">{r.audience}</span> : null}
                  <h3 style={{ margin: "10px 0 3px" }}>{r.bootcampName}</h3>
                  <div className="note">
                    {r.cohortName ? `${r.cohortName} · ` : ""}
                    {r.deadline ? `Due ${fmtDeadline(r.deadline)}` : "No deadline"}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 120 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-mono), monospace",
                      fontSize: 22,
                      fontWeight: 600,
                      color: "var(--indigo)",
                    }}
                  >
                    {r.pct}%
                  </div>
                  <div className="note">
                    {r.doneCount} / {r.total} done
                  </div>
                  {/* @feature: time-based-progress-v1 — admin-only, staff view only */}
                  <div className="note" style={{ marginTop: 2 }}>
                    Time: {r.timePct == null ? "—" : `${r.timePct}%`}
                  </div>
                </div>
              </div>
              <div className="pbar" style={{ margin: "12px 0 8px" }}>
                <div className="pbar-fill" style={{ width: `${r.pct}%` }} />
              </div>
              <div style={{ marginTop: 6 }}>
                {r.items.length === 0 ? (
                  <div className="note">No content in this bootcamp yet.</div>
                ) : (
                  r.items.map((it, idx) => (
                    <div
                      key={it.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 0",
                        borderTop: idx ? "1px solid var(--line)" : "none",
                      }}
                    >
                      <span
                        style={
                          it.done
                            ? {
                                width: 18,
                                height: 18,
                                borderRadius: "50%",
                                background: "var(--ok)",
                                color: "#fff",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 11,
                                flexShrink: 0,
                              }
                            : {
                                width: 18,
                                height: 18,
                                borderRadius: "50%",
                                border: "1.5px solid var(--line-d)",
                                flexShrink: 0,
                              }
                        }
                      >
                        {it.done ? "✓" : ""}
                      </span>
                      <span style={{ flex: 1, fontSize: 14 }}>{it.title}</span>
                      <span className="note" style={{ whiteSpace: "nowrap" }}>
                        {it.type === "knowledge_check"
                          ? it.score
                            ? `Quiz · ${it.score.score}/${it.score.total}`
                            : "Quiz"
                          : kindLabel(it.type)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
