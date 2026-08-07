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

  // v3: per-enrollment deadline edit + unassign
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [editErr, setEditErr] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [acting, setActing] = useState(false);
  const [unErr, setUnErr] = useState("");

  // @feature: quiz-per-question-review-v1 — which knowledge-check rows are expanded
  const [expandedQuiz, setExpandedQuiz] = useState(new Set());

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
      questions = [], // @feature: quiz-per-question-review-v1
      comps = [],
      scores = [],
      responses = [], // @feature: quiz-per-question-review-v1
      timeProg = []; // @feature: time-based-progress-v1
    if (bootcampIds.length) {
      const { data: its } = await supabase
        .from("items")
        .select("id, bootcamp_id, title, type, weight, position")
        .in("bootcamp_id", bootcampIds)
        .order("position");
      items = its || [];
      const itemIds = items.map((i) => i.id);
      if (itemIds.length) {
        // @feature: quiz-per-question-review-v1 — prompts/options/answer key,
        // fetched regardless of item type; only knowledge_check rows will match.
        const { data: qs } = await supabase
          .from("questions")
          .select("id, item_id, prompt, options, answer_index, position")
          .in("item_id", itemIds)
          .order("position");
        questions = qs || [];
      }
    }
    if (enrollmentIds.length) {
      const [{ data: c }, { data: s }, { data: rs }, { data: tp }] = await Promise.all([
        supabase.from("completions").select("enrollment_id, item_id").in("enrollment_id", enrollmentIds),
        supabase
          .from("quiz_scores")
          .select("enrollment_id, item_id, score, total")
          .in("enrollment_id", enrollmentIds),
        supabase
          .from("quiz_responses") // @feature: quiz-per-question-review-v1
          .select("enrollment_id, item_id, question_id, selected_index, correct")
          .in("enrollment_id", enrollmentIds),
        supabase
          .from("enrollment_time_progress") // @feature: time-based-progress-v1
          .select("enrollment_id, time_pct")
          .in("enrollment_id", enrollmentIds),
      ]);
      comps = c || [];
      scores = s || [];
      responses = rs || []; // @feature: quiz-per-question-review-v1
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
      // @feature: quiz-per-question-review-v1 — this enrollment's responses,
      // grouped by item so each knowledge check looks up only its own picks.
      const responsesByItem = {};
      responses
        .filter((r) => r.enrollment_id === e.id)
        .forEach((r) => {
          (responsesByItem[r.item_id] = responsesByItem[r.item_id] || []).push(r);
        });
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
        items: its.map((i) => {
          // @feature: quiz-per-question-review-v1
          const itemQuestions = questions.filter((q) => q.item_id === i.id);
          const itemResponses = responsesByItem[i.id] || [];
          const responseMap = Object.fromEntries(itemResponses.map((r) => [r.question_id, r]));
          return {
            id: i.id,
            title: i.title,
            type: i.type,
            done: compSet.has(i.id),
            score: scoreMap[i.id] || null,
            questions:
              i.type === "knowledge_check"
                ? itemQuestions.map((q) => ({ ...q, response: responseMap[q.id] || null }))
                : [],
            // Per-question rows only exist for attempts submitted after this
            // feature shipped — an older completion has a score but nothing here.
            hasResponseDetail: i.type === "knowledge_check" && itemQuestions.length > 0 && itemResponses.length > 0,
          };
        }),
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

  // v3: deadline edit
  function startEdit(eid, cur) {
    setEditErr("");
    setEditId(eid);
    setEditVal(cur || "");
  }
  function cancelEdit() {
    setEditId(null);
    setEditVal("");
    setEditErr("");
  }
  async function saveDeadline(eid, clear) {
    setEditErr("");
    setSavingId(eid);
    const newVal = clear ? null : editVal || null;
    // .select() + empty-check: an RLS block returns success with 0 rows, so verify a row actually changed.
    const { data, error } = await supabase
      .from("enrollments")
      .update({ deadline: newVal })
      .eq("id", eid)
      .select("id");
    setSavingId(null);
    if (error) {
      setEditErr(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setEditErr("Update was blocked — no permission. The enrollments RLS migration may not have run yet.");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === eid ? { ...r, deadline: newVal } : r)));
    setEditId(null);
    setEditVal("");
  }

  // @feature: quiz-per-question-review-v1
  function toggleQuizExpand(itemId) {
    setExpandedQuiz((prev) => {
      const n = new Set(prev);
      if (n.has(itemId)) n.delete(itemId);
      else n.add(itemId);
      return n;
    });
  }

  // v3: unassign (hard delete; children cascade)
  function openConfirm(eid) {
    setUnErr("");
    setConfirmId(eid);
  }
  async function doUnassign() {
    setUnErr("");
    setActing(true);
    const { data, error } = await supabase
      .from("enrollments")
      .delete()
      .eq("id", confirmId)
      .select("id");
    setActing(false);
    if (error) {
      setUnErr(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setUnErr("Removal was blocked — no permission. The enrollments RLS migration may not have run yet.");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== confirmId));
    setConfirmId(null);
  }

  const confirmRow = rows.find((r) => r.id === confirmId);

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
                  <div className="note" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>
                      {r.cohortName ? `${r.cohortName} · ` : ""}
                      {r.deadline ? `Due ${fmtDeadline(r.deadline)}` : "No deadline"}
                    </span>
                    {editId === r.id ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                          type="date"
                          className="input"
                          style={{ width: "auto", padding: "5px 8px", fontSize: 12 }}
                          value={editVal}
                          onChange={(e) => setEditVal(e.target.value)}
                        />
                        <button className="btn sm pri" onClick={() => saveDeadline(r.id, false)} disabled={savingId === r.id}>
                          {savingId === r.id ? "…" : "Save"}
                        </button>
                        <button className="btn sm ghost" onClick={cancelEdit} disabled={savingId === r.id}>
                          Cancel
                        </button>
                        {r.deadline && (
                          <button className="btn sm link" onClick={() => saveDeadline(r.id, true)} disabled={savingId === r.id}>
                            Clear
                          </button>
                        )}
                      </span>
                    ) : (
                      <button className="btn link sm" style={{ padding: "2px 4px" }} onClick={() => startEdit(r.id, r.deadline)}>
                        Edit deadline
                      </button>
                    )}
                  </div>
                  {editId === r.id && editErr && (
                    <div className="notice error" style={{ marginTop: 8, maxWidth: 420 }}>{editErr}</div>
                  )}
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
                  r.items.map((it, idx) => {
                    // @feature: quiz-per-question-review-v1
                    const isQuiz = it.type === "knowledge_check";
                    const canExpand = isQuiz && !!it.score;
                    const isOpen = expandedQuiz.has(it.id);
                    return (
                      <div key={it.id} style={{ borderTop: idx ? "1px solid var(--line)" : "none" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0" }}>
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
                            {isQuiz
                              ? it.score
                                ? `Quiz · ${it.score.score}/${it.score.total}`
                                : "Quiz"
                              : kindLabel(it.type)}
                          </span>
                          {canExpand && (
                            <button
                              className="btn link sm"
                              style={{ padding: "2px 4px", whiteSpace: "nowrap" }}
                              onClick={() => toggleQuizExpand(it.id)}
                            >
                              {isOpen ? "Hide answers" : "Show answers"}
                            </button>
                          )}
                        </div>
                        {canExpand && isOpen && (
                          <div style={{ padding: "0 0 14px 28px" }}>
                            {!it.hasResponseDetail ? (
                              <div className="note" style={{ fontSize: 12 }}>
                                Per-question detail isn&rsquo;t available for this attempt — it was taken before
                                this feature was added.
                              </div>
                            ) : (
                              it.questions.map((q, qi) => {
                                const picked = q.response?.selected_index;
                                const wasCorrect = q.response?.correct;
                                const leftBlank = picked == null || picked === -1;
                                return (
                                  <div
                                    key={q.id}
                                    style={{ marginBottom: qi < it.questions.length - 1 ? 14 : 0 }}
                                  >
                                    <div className="note" style={{ fontSize: 12, marginBottom: 4 }}>
                                      Question {qi + 1} · {leftBlank ? "Left blank" : wasCorrect ? "Correct" : "Incorrect"}
                                    </div>
                                    <div style={{ fontSize: 13, marginBottom: 6, whiteSpace: "pre-wrap" }}>
                                      {q.prompt}
                                    </div>
                                    {(q.options || []).map((opt, oi) => {
                                      const isAnswer = oi === q.answer_index;
                                      const isPicked = oi === picked;
                                      let color = "var(--gray)";
                                      let weight = 400;
                                      if (isAnswer) {
                                        color = "var(--ok)";
                                        weight = 600;
                                      } else if (isPicked && !wasCorrect) {
                                        color = "var(--danger)";
                                        weight = 600;
                                      }
                                      return (
                                        <div
                                          key={oi}
                                          style={{ fontSize: 13, color, fontWeight: weight, padding: "2px 0" }}
                                        >
                                          {isAnswer ? "✓ " : isPicked ? "✗ " : "· "}
                                          {opt}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* v3: unassign */}
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid var(--line)",
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <button className="btn ghost danger sm" onClick={() => openConfirm(r.id)}>
                  Unassign
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* v3: unassign confirm modal */}
      {confirmId && confirmRow && (
        <div
          onClick={() => !acting && setConfirmId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20,20,45,.4)",
            zIndex: 100,
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line-d)",
              borderRadius: "var(--r-lg)",
              padding: 24,
              maxWidth: 440,
              width: "100%",
              boxShadow: "0 20px 50px rgba(20,20,45,.25)",
            }}
          >
            <h3 style={{ marginBottom: 8 }}>Remove assignment?</h3>
            <p className="note" style={{ fontSize: 13, color: "var(--gray)", marginBottom: 6 }}>
              This unassigns <strong>{confirmRow.bootcampName}</strong> from {profile.full_name || profile.email}.
            </p>
            <p className="note" style={{ fontSize: 13, color: "var(--danger)", marginBottom: 18 }}>
              Their completions and quiz scores for this bootcamp will be permanently deleted. This can&rsquo;t be undone.
            </p>
            {unErr && <div className="notice error" style={{ marginBottom: 12 }}>{unErr}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setConfirmId(null)} disabled={acting}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: "var(--danger)", color: "#fff" }}
                onClick={doUnassign}
                disabled={acting}
              >
                {acting ? "Removing…" : "Remove assignment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
