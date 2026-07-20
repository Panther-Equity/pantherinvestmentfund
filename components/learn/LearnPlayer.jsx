"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

function ytEmbed(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    let id = "";
    if (u.hostname.includes("youtu.be")) id = u.pathname.slice(1);
    else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/embed/")[1];
    else id = u.searchParams.get("v") || "";
    id = (id || "").split(/[?&/]/)[0];
    return id ? `https://www.youtube.com/embed/${id}` : null;
  } catch {
    return null;
  }
}

// pipe-delimited stem lines -> real table; other lines -> paragraphs
function renderPrompt(text) {
  const lines = (text || "").split("\n");
  const out = [];
  let rows = null;
  const flush = () => {
    if (rows) {
      out.push(
        <table className="qtable" key={`t${out.length}`}>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className={ci > 0 && /\d/.test(c) ? "num" : ""}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      rows = null;
    }
  };
  lines.forEach((line) => {
    if (line.includes("|")) {
      (rows = rows || []).push(line.split("|").map((c) => c.trim()));
    } else {
      flush();
      if (line.trim())
        out.push(
          <p className="qpar" key={`p${out.length}`}>
            {line.trim()}
          </p>
        );
    }
  });
  flush();
  return out;
}

function kindShort(t) {
  return t === "knowledge_check" ? "Quiz" : t === "project_video" ? "Project" : "Video";
}
function kindLong(t) {
  return t === "knowledge_check" ? "Knowledge check" : t === "project_video" ? "Project" : "Lesson";
}

export default function LearnPlayer({ bootcampId }) {
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [enrolled, setEnrolled] = useState(true);
  const [enr, setEnr] = useState(null);
  const [bc, setBc] = useState(null);
  const [items, setItems] = useState([]);
  const [completed, setCompleted] = useState(new Set());
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState({});
  const [current, setCurrent] = useState(0);
  const [attempts, setAttempts] = useState({}); // item_id -> { started_at, submitted_at }
  const [nowTs, setNowTs] = useState(Date.now());
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: enrRow } = await supabase
      .from("enrollments")
      .select("id")
      .eq("user_id", user.id)
      .eq("bootcamp_id", bootcampId)
      .limit(1)
      .maybeSingle();
    if (!enrRow) {
      setEnrolled(false);
      setLoading(false);
      return;
    }
    setEnr(enrRow);

    const { data: b } = await supabase
      .from("bootcamps")
      .select("id, name, audience, workbook_path")
      .eq("id", bootcampId)
      .single();
    setBc(b);

    const { data: its } = await supabase
      .from("items")
      .select("*")
      .eq("bootcamp_id", bootcampId)
      .order("position");
    const ids = (its || []).map((i) => i.id);

    let qs = [],
      sols = [];
    if (ids.length) {
      const [{ data: q }, { data: s }] = await Promise.all([
        supabase.from("questions").select("*").in("item_id", ids).order("position"),
        supabase.from("item_solutions").select("*").in("item_id", ids).order("position"),
      ]);
      qs = q || [];
      sols = s || [];
    }
    const built = (its || []).map((it) => ({
      ...it,
      solutions: sols.filter((s) => s.item_id === it.id),
      questions: qs.filter((q) => q.item_id === it.id).map((q) => ({ ...q, options: q.options || [] })),
    }));
    setItems(built);

    const [{ data: comp }, { data: sc }, { data: att }] = await Promise.all([
      supabase.from("completions").select("item_id").eq("enrollment_id", enrRow.id),
      supabase.from("quiz_scores").select("item_id, score, total").eq("enrollment_id", enrRow.id),
      supabase.from("quiz_attempts").select("item_id, started_at, submitted_at").eq("enrollment_id", enrRow.id),
    ]);
    const compSet = new Set((comp || []).map((c) => c.item_id));
    setCompleted(compSet);
    setSubmitted(Object.fromEntries((sc || []).map((r) => [r.item_id, { score: r.score, total: r.total }])));
    setAttempts(
      Object.fromEntries((att || []).map((a) => [a.item_id, { started_at: a.started_at, submitted_at: a.submitted_at }]))
    );

    const firstIncomplete = built.findIndex((it) => !compSet.has(it.id));
    setCurrent(firstIncomplete === -1 ? 0 : firstIncomplete);
    setLoading(false);
  }, [bootcampId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Timed knowledge checks: tick the countdown once a second and auto-submit at zero.
  // The deadline is derived from the server's started_at, so leaving/refreshing resumes
  // the same clock rather than restarting it.
  useEffect(() => {
    const it = items[current];
    if (!it || it.type !== "knowledge_check" || !it.timed) return;
    const att = attempts[it.id];
    if (!att || submitted[it.id]) return;
    const deadline = new Date(att.started_at).getTime() + (it.time_limit_minutes || 30) * 60000;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      submitCheck(it);
    };
    if (Date.now() >= deadline) {
      fire();
      return;
    }
    setNowTs(Date.now());
    const iv = setInterval(() => {
      setNowTs(Date.now());
      if (Date.now() >= deadline) {
        clearInterval(iv);
        fire();
      }
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, items, attempts, submitted]);

  const totalW = items.reduce((s, it) => s + (it.weight || 1), 0);
  const doneW = items.filter((it) => completed.has(it.id)).reduce((s, it) => s + (it.weight || 1), 0);
  const pct = totalW ? Math.round((100 * doneW) / totalW) : 0;

  function go(d) {
    setCurrent((c) => Math.min(items.length - 1, Math.max(0, c + d)));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function jump(idx) {
    setCurrent(idx);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleComplete(it) {
    if (completed.has(it.id)) {
      await supabase.from("completions").delete().eq("enrollment_id", enr.id).eq("item_id", it.id);
      setCompleted((prev) => {
        const n = new Set(prev);
        n.delete(it.id);
        return n;
      });
    } else {
      await supabase
        .from("completions")
        .upsert({ enrollment_id: enr.id, item_id: it.id }, { onConflict: "enrollment_id,item_id", ignoreDuplicates: true });
      setCompleted((prev) => new Set(prev).add(it.id));
    }
  }
  function pick(itemId, questionId, idx) {
    setAnswers((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), [questionId]: idx } }));
  }
  async function startTimed(it) {
    let startedAt = null;
    const { data, error } = await supabase
      .from("quiz_attempts")
      .insert({ enrollment_id: enr.id, item_id: it.id })
      .select("started_at")
      .single();
    if (error) {
      // An attempt already exists (e.g. started on another device) — use its start time.
      const { data: ex } = await supabase
        .from("quiz_attempts")
        .select("started_at")
        .eq("enrollment_id", enr.id)
        .eq("item_id", it.id)
        .maybeSingle();
      startedAt = ex?.started_at || new Date().toISOString();
    } else {
      startedAt = data?.started_at || new Date().toISOString();
    }
    setAttempts((prev) => ({ ...prev, [it.id]: { started_at: startedAt, submitted_at: null } }));
    setNowTs(Date.now());
  }
  async function submitCheck(it) {
    const picks = answersRef.current[it.id] || {};
    let score = 0;
    it.questions.forEach((q) => {
      if (picks[q.id] === q.answer_index) score++;
    });
    const total = it.questions.length;
    await supabase
      .from("quiz_scores")
      .upsert({ enrollment_id: enr.id, item_id: it.id, score, total }, { onConflict: "enrollment_id,item_id" });
    await supabase
      .from("completions")
      .upsert({ enrollment_id: enr.id, item_id: it.id }, { onConflict: "enrollment_id,item_id", ignoreDuplicates: true });
    if (it.timed) {
      await supabase
        .from("quiz_attempts")
        .update({ submitted_at: new Date().toISOString() })
        .eq("enrollment_id", enr.id)
        .eq("item_id", it.id);
    }
    setSubmitted((prev) => ({ ...prev, [it.id]: { score, total } }));
    setCompleted((prev) => new Set(prev).add(it.id));
    setAttempts((prev) =>
      prev[it.id] ? { ...prev, [it.id]: { ...prev[it.id], submitted_at: new Date().toISOString() } } : prev
    );
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function retake(it) {
    if (it.timed) {
      // A retake of a timed check gets a fresh clock: clear the attempt, score, and completion.
      await supabase.from("quiz_attempts").delete().eq("enrollment_id", enr.id).eq("item_id", it.id);
      await supabase.from("quiz_scores").delete().eq("enrollment_id", enr.id).eq("item_id", it.id);
      await supabase.from("completions").delete().eq("enrollment_id", enr.id).eq("item_id", it.id);
      setAttempts((prev) => {
        const n = { ...prev };
        delete n[it.id];
        return n;
      });
      setCompleted((prev) => {
        const n = new Set(prev);
        n.delete(it.id);
        return n;
      });
    }
    setSubmitted((prev) => {
      const n = { ...prev };
      delete n[it.id];
      return n;
    });
    setAnswers((prev) => ({ ...prev, [it.id]: {} }));
  }
  async function downloadWorkbook() {
    const { data } = await supabase.storage.from("workbooks").createSignedUrl(bc.workbook_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  function renderItem(it) {
    const done = completed.has(it.id);
    const embed = ytEmbed(it.video_url);
    const res = submitted[it.id];
    const att = attempts[it.id];
    const notStartedTimed = it.type === "knowledge_check" && it.timed && !att && !res;
    const timedActive = it.type === "knowledge_check" && it.timed && !!att && !res;
    let remainingMs = null;
    if (timedActive) {
      const deadline = new Date(att.started_at).getTime() + (it.time_limit_minutes || 30) * 60000;
      remainingMs = Math.max(0, deadline - nowTs);
    }
    return (
      <div className="lesson">
        <div className="lesson-kind">{kindLong(it.type)}</div>
        <h2 className="lesson-h">{it.title}</h2>

        {(it.type === "video" || it.type === "project_video") && (
          <>
            {embed ? (
              <div className="embed">
                <iframe
                  src={embed}
                  title={it.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="embed-ph">
                <span>Video coming soon</span>
              </div>
            )}
            {it.type === "video" && it.drill_text ? <div className="drill">{it.drill_text}</div> : null}
            {it.solutions && it.solutions.length ? (
              <div style={{ margin: "6px 0 4px" }}>
                {it.solutions.map((s) =>
                  s.url ? (
                    <a key={s.id} className="sol-link" href={s.url} target="_blank" rel="noreferrer">
                      ▸ {s.title || "Solution walkthrough"}
                    </a>
                  ) : null
                )}
              </div>
            ) : null}
            <div className="complete-row" onClick={() => toggleComplete(it)}>
              <span className={`check ${done ? "on" : ""}`}>{done ? "✓" : ""}</span>
              {done ? "Completed" : "Mark complete"}
            </div>
          </>
        )}

        {it.type === "knowledge_check" &&
          (notStartedTimed ? (
            <div
              className="startgate"
              style={{
                marginTop: 8,
                padding: 18,
                border: "1px solid var(--line-d)",
                borderRadius: "var(--r)",
                background: "var(--wash)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>
                Timed check · {it.time_limit_minutes} minutes
              </div>
              <p className="note" style={{ marginBottom: 14, maxWidth: 520 }}>
                Once you press Start, the {it.time_limit_minutes}-minute timer begins and keeps running even if you
                leave or refresh. Your answers submit automatically when it reaches zero.
              </p>
              <button className="btn pri" onClick={() => startTimed(it)}>
                Start ({it.time_limit_minutes} min)
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 4 }}>
              {timedActive ? (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    borderRadius: "var(--r)",
                    marginBottom: 14,
                    fontFamily: "var(--font-mono), monospace",
                    fontWeight: 600,
                    fontSize: 14,
                    background: remainingMs <= 60000 ? "var(--danger-t)" : "var(--indigo-t)",
                    color: remainingMs <= 60000 ? "var(--danger)" : "var(--indigo)",
                  }}
                >
                  ⏱ {String(Math.floor(remainingMs / 60000)).padStart(2, "0")}:
                  {String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0")} left
                </div>
              ) : null}
              {it.questions.map((q, qi) => {
                const myPick = (answers[it.id] || {})[q.id];
                return (
                  <div key={q.id} className="qcard-l">
                    <div className="qnum">Question {qi + 1}</div>
                    <div className="qbody">{renderPrompt(q.prompt)}</div>
                    <div className="qselect">Select one:</div>
                    {q.options.map((opt, oi) => {
                      let cls = "opt";
                      if (res) {
                        if (oi === q.answer_index) cls += " correct";
                        else if (myPick === oi) cls += " wrong";
                      } else if (myPick === oi) cls += " sel";
                      return (
                        <div key={oi} className={cls} onClick={() => (res ? null : pick(it.id, q.id, oi))}>
                          <span className="dot" />
                          <span style={{ whiteSpace: "pre-wrap" }}>{opt}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {res ? (
                <>
                  <div className="scorebox">
                    You scored {res.score} / {res.total}. Correct answers are highlighted in green.
                  </div>
                  <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => retake(it)}>
                    Retake
                  </button>
                </>
              ) : (
                <button
                  className="btn pri"
                  style={{ marginTop: 12 }}
                  disabled={!it.timed && Object.keys(answers[it.id] || {}).length < it.questions.length}
                  onClick={() => submitCheck(it)}
                >
                  Submit answers
                </button>
              )}
            </div>
          ))}
      </div>
    );
  }

  if (loading) return <div className="stub">Loading…</div>;
  if (!enrolled)
    return (
      <>
        <button className="btn link" onClick={() => router.push("/learn")}>
          ← Back
        </button>
        <div className="stub">You&apos;re not enrolled in this bootcamp yet.</div>
      </>
    );

  const item = items[current];

  return (
    <div>
      <button className="btn link" onClick={() => router.push("/learn")}>
        ← All bootcamps
      </button>

      <div className="player">
        <aside className="player-side">
          {bc?.audience ? <span className="badge b-aud">{bc.audience}</span> : null}
          <h2 className="player-title">{bc?.name}</h2>
          <div className="pbar">
            <div className="pbar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="note" style={{ margin: "8px 0 12px" }}>
            {pct}% complete
          </div>
          {bc?.workbook_path ? (
            <button className="btn ghost sm" style={{ width: "100%", marginBottom: 14 }} onClick={downloadWorkbook}>
              Download drill workbook
            </button>
          ) : null}
          <div className="itemnav">
            {items.map((it, idx) => (
              <button key={it.id} className={`navitem ${idx === current ? "on" : ""}`} onClick={() => jump(idx)}>
                <span className={`navcheck ${completed.has(it.id) ? "done" : ""}`}>
                  {completed.has(it.id) ? "✓" : ""}
                </span>
                <span className="navlabel">{it.title}</span>
                <span className="navkind">{kindShort(it.type)}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="player-main">
          {item ? renderItem(item) : <div className="stub">No content in this bootcamp yet.</div>}
          {items.length ? (
            <div className="player-nav">
              <button className="btn ghost" disabled={current === 0} onClick={() => go(-1)}>
                ← Back
              </button>
              <span className="note">
                {current + 1} of {items.length}
              </span>
              {current === items.length - 1 ? (
                <button className="btn pri" onClick={() => router.push("/learn")}>
                  Finish ✓
                </button>
              ) : (
                <button className="btn pri" onClick={() => go(1)}>
                  Next →
                </button>
              )}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
