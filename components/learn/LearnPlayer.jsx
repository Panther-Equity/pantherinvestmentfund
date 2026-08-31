"use client";
// @feature: no-skip-forward-v1
// Rewind-allowed, no-skip-forward video control: the plain <iframe> embed is
// replaced with the YouTube IFrame Player API so we can track the furthest
// point a student has watched and snap any forward-seek back to it. Backward
// seeks are always free. This is a deterrent for casual skipping, not a hard
// lock — the unlisted YouTube URL is still directly reachable outside the app.
// Furthest-watched is persisted to public.video_progress (enrollment_id, item_id).
//
// @feature: project-render-fix-v1 (2026-08-08)
// Projects, series, attached files, and intro_text were implemented in
// PreviewPlayer but never ported here, so the student view of a project item
// showed an empty "Video coming soon" frame with no instructions, no
// downloads, and no way to confirm an attempt. Ported in full:
//   - item_files and item_steps are now fetched alongside questions/solutions
//   - intro_text renders for projects and series
//   - project_video gets its own render branch with a LIVE submit-confirm
//     button (PreviewPlayer's is deliberately inert)
//   - video_series renders with internal step navigation
//
// @feature: watch-gate-v1 (2026-08-08)
// "Mark complete" on a plain video item is gated on furthest-watched reaching
// WATCH_THRESHOLD of the known duration. Fails OPEN when duration_seconds is
// unknown (staff hasn't previewed the video yet) so a missing duration can
// never strand a student. Existing completions are untouched — the gate only
// governs marking something complete from here on.
//
// @feature: file-download-tracking-v1 (2026-08-13)
// Nothing recorded that a workbook or project file was opened: both download
// helpers minted a signed URL and opened it, with no row written. So there was
// no way to tell whether the drill workbook was being used at all. Every
// download now logs to public.file_downloads. See logDownload for why it is
// deliberately fire-and-forget.
//
// @feature: workbook-on-map-v1 (2026-08-13)
// The drill workbook button existed only in the lesson sidebar, so it was
// unreachable from the course map — the screen students actually land on, and
// the screen whose own description says the workbook is required. See renderMap.
//
// @feature: knowledge-check-integrity-v1 (2026-08-31) — CRIT-4
// Two client-writable holes closed, both the same shape: the browser was the
// source of truth for something that should be server-decided.
//   1. Quiz grading moved server-side into grade_quiz_attempt(). questions no
//      longer fetches answer_index; submitCheck() sends raw picks and renders
//      whatever the RPC hands back. quiz_scores/quiz_responses lost their
//      direct student INSERT.
//   2. Marking a plain video item complete moved into mark_watched(), which
//      re-checks the 90%-watched threshold server-side instead of trusting a
//      client upsert. completions lost direct student INSERT for
//      type in ('knowledge_check','video') specifically — video_series and
//      project_video completions are unchanged, a separate flagged gap.
// See knowledge-check-integrity-migration.sql for the database side.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

const SKIP_TOLERANCE_SECONDS = 2; // absorbs polling jitter, not a real allowance to skip ahead
const POLL_MS = 500;
const SAVE_INTERVAL_MS = 10000;
const MIN_DELTA_TO_SAVE = 2; // don't write to the DB for sub-2s progress ticks
const WATCH_THRESHOLD = 0.9; // fraction of a video that must be watched before it can be marked complete — mirrors mark_watched()'s server-side check, used here only for the UI hint

function ytVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    let id = "";
    if (u.hostname.includes("youtu.be")) id = u.pathname.slice(1);
    else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/embed/")[1];
    else id = u.searchParams.get("v") || "";
    id = (id || "").split(/[?&/]/)[0];
    return id || null;
  } catch {
    return null;
  }
}

// Loads the YouTube IFrame API script once (idempotent — safe if called
// multiple times, e.g. across item switches) and resolves with window.YT.
let ytApiPromise = null;
function loadYouTubeIframeApi() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
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
  if (t === "knowledge_check") return "Quiz";
  if (t === "project_video") return "Project";
  if (t === "video_series") return "Series";
  return "Video";
}
function kindLong(t) {
  if (t === "knowledge_check") return "Knowledge check";
  if (t === "project_video") return "Project";
  if (t === "video_series") return "Video series";
  return "Lesson";
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
  const [view, setView] = useState("map"); // "map" | "lesson" — course opens on the tile map
  const [attempts, setAttempts] = useState({}); // item_id -> { started_at, submitted_at }
  const [videoProgress, setVideoProgress] = useState({}); // item_id -> furthest_seconds watched
  const [projectSubs, setProjectSubs] = useState(new Set()); // item_ids with a confirmed attempt
  const [subBusy, setSubBusy] = useState(null); // item_id currently being confirmed
  const [subError, setSubError] = useState(null);
  const [seriesStep, setSeriesStep] = useState({}); // item_id -> active step index
  const [stepProgress, setStepProgress] = useState({}); // step_id -> furthest (session-local)
  const [nowTs, setNowTs] = useState(Date.now());
  // @feature: knowledge-check-integrity-v1 — item_id -> { question_id: answer_index|null },
  // filled in from grade_quiz_attempt()'s own response. Never populated from the initial load.
  const [revealed, setRevealed] = useState({});
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const playerRef = useRef(null); // current YT.Player instance, for debugging/inspection only

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
      .select("id, name, audience, workbook_path, description")
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
      sols = [],
      steps = [],
      files = [];
    if (ids.length) {
      // @feature: project-render-fix-v1 — item_steps and item_files were missing
      // from this fetch, which is the root cause of blank projects and series.
      const [{ data: q }, { data: s }, { data: st }, { data: f }] = await Promise.all([
        // @feature: knowledge-check-integrity-v1 (2026-08-31) — answer_index no
        // longer ships to the browser before submission. It comes back from
        // grade_quiz_attempt()'s own response instead, gated on reveal_answers.
        supabase.from("questions").select("id, item_id, prompt, options, position").in("item_id", ids).order("position"),
        supabase.from("item_solutions").select("*").in("item_id", ids).order("position"),
        supabase.from("item_steps").select("*").in("item_id", ids).order("position"),
        supabase.from("item_files").select("*").in("item_id", ids).order("position"),
      ]);
      qs = q || [];
      sols = s || [];
      steps = st || [];
      files = f || [];
    }
    const built = (its || []).map((it) => ({
      ...it,
      solutions: sols.filter((s) => s.item_id === it.id),
      steps: steps.filter((s) => s.item_id === it.id),
      files: files.filter((f) => f.item_id === it.id),
      questions: qs.filter((q) => q.item_id === it.id).map((q) => ({ ...q, options: q.options || [] })),
    }));
    setItems(built);

    const [{ data: comp }, { data: sc }, { data: att }, { data: vp }, { data: psub }] = await Promise.all([
      supabase.from("completions").select("item_id").eq("enrollment_id", enrRow.id),
      supabase.from("quiz_scores").select("item_id, score, total").eq("enrollment_id", enrRow.id),
      supabase.from("quiz_attempts").select("item_id, started_at, submitted_at").eq("enrollment_id", enrRow.id),
      supabase.from("video_progress").select("item_id, furthest_seconds").eq("enrollment_id", enrRow.id),
      supabase.from("project_submissions").select("item_id").eq("enrollment_id", enrRow.id),
    ]);
    const compSet = new Set((comp || []).map((c) => c.item_id));
    setCompleted(compSet);
    setSubmitted(Object.fromEntries((sc || []).map((r) => [r.item_id, { score: r.score, total: r.total }])));
    setAttempts(
      Object.fromEntries((att || []).map((a) => [a.item_id, { started_at: a.started_at, submitted_at: a.submitted_at }]))
    );
    setVideoProgress(Object.fromEntries((vp || []).map((r) => [r.item_id, Number(r.furthest_seconds) || 0])));
    setProjectSubs(new Set((psub || []).map((r) => r.item_id)));

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

  // The video currently on screen: either the item's own, or the active step's
  // inside a series. Derived as primitives so the player effect re-runs on step
  // change but not on unrelated updates.
  const activeItem = items[current];
  const activeIsSeries = activeItem?.type === "video_series";
  const activeStepIdx = activeIsSeries
    ? Math.min(seriesStep[activeItem.id] ?? 0, Math.max(0, (activeItem.steps || []).length - 1))
    : -1;
  const activeStep = activeIsSeries ? (activeItem.steps || [])[activeStepIdx] : null;
  const activeVideoKey = activeItem
    ? activeIsSeries
      ? activeStep?.id || null
      : activeItem.type === "video"
      ? activeItem.id
      : null
    : null;
  const activeVideoUrl = activeIsSeries ? activeStep?.video_url || "" : activeItem?.video_url || "";
  const activeDuration = activeIsSeries
    ? Number(activeStep?.duration_seconds) || 0
    : Number(activeItem?.duration_seconds) || 0;

  // No-skip-forward video control: create/tear down a YT.Player for whichever
  // video is currently active (item-level, or the active step of a series).
  // Polls playback position; any forward jump past the furthest point ever
  // reached gets snapped back. Backward seeks are always allowed.
  //
  // Item-level furthest is persisted (throttled) to video_progress. Step-level
  // furthest is session-local only for now — public.step_progress exists but its
  // exact shape hasn't been verified from this file, so writing to it is
  // deliberately deferred rather than guessed at.
  useEffect(() => {
    if (!activeVideoKey || !enr) return;
    const videoId = ytVideoId(activeVideoUrl);
    if (!videoId) return;

    const isStep = activeIsSeries;
    const hostId = isStep ? `yt-step-${activeVideoKey}` : `yt-${activeVideoKey}`;

    let destroyed = false;
    let player = null;
    let pollIv = null;
    let saveIv = null;
    let furthest = (isStep ? stepProgress[activeVideoKey] : videoProgress[activeVideoKey]) || 0;
    let lastSaved = furthest;
    let gateReached = false;

    const persist = async (seconds) => {
      if (isStep || !enr) return; // step-level persistence deferred (see note above)
      try {
        await supabase.from("video_progress").upsert(
          { enrollment_id: enr.id, item_id: activeVideoKey, furthest_seconds: seconds, updated_at: new Date().toISOString() },
          { onConflict: "enrollment_id,item_id" }
        );
      } catch {
        // best-effort; a failed save just means a slightly larger delta gets retried next tick
      }
    };

    const pushToState = (seconds) => {
      if (isStep) {
        setStepProgress((prev) => ({ ...prev, [activeVideoKey]: Math.max(prev[activeVideoKey] || 0, seconds) }));
      } else {
        setVideoProgress((prev) => ({ ...prev, [activeVideoKey]: Math.max(prev[activeVideoKey] || 0, seconds) }));
      }
    };

    loadYouTubeIframeApi().then((YT) => {
      if (destroyed) return;
      const hostEl = document.getElementById(hostId);
      if (!hostEl) return;
      player = new YT.Player(hostId, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, modestbranding: 1 },
      });
      playerRef.current = player;

      pollIv = setInterval(() => {
        if (!player || typeof player.getCurrentTime !== "function") return;
        let t;
        try {
          t = player.getCurrentTime();
        } catch {
          return;
        }
        if (typeof t !== "number" || Number.isNaN(t)) return;
        if (t > furthest + SKIP_TOLERANCE_SECONDS) {
          try {
            player.seekTo(furthest, true);
          } catch {
            /* no-op */
          }
        } else if (t > furthest) {
          furthest = t;
          // @feature: watch-gate-v1 — surface the crossing immediately so the
          // Mark complete control unlocks the moment the threshold is met,
          // rather than waiting for the next 10s save or a navigation away.
          if (!gateReached && activeDuration > 0 && furthest >= activeDuration * WATCH_THRESHOLD) {
            gateReached = true;
            pushToState(furthest);
          }
        }
      }, POLL_MS);

      saveIv = setInterval(() => {
        if (furthest - lastSaved >= MIN_DELTA_TO_SAVE) {
          lastSaved = furthest;
          persist(furthest);
          pushToState(furthest);
        }
      }, SAVE_INTERVAL_MS);
    });

    return () => {
      destroyed = true;
      if (pollIv) clearInterval(pollIv);
      if (saveIv) clearInterval(saveIv);
      if (furthest - lastSaved >= 1) {
        lastSaved = furthest;
        persist(furthest);
      }
      pushToState(furthest);
      if (player && typeof player.destroy === "function") {
        try {
          player.destroy();
        } catch {
          /* no-op */
        }
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVideoKey, activeVideoUrl, activeIsSeries, enr]);

  const totalW = items.reduce((s, it) => s + (it.weight || 1), 0);
  const doneW = items.filter((it) => completed.has(it.id)).reduce((s, it) => s + (it.weight || 1), 0);
  const pct = totalW ? Math.round((100 * doneW) / totalW) : 0;

  // @feature: watch-gate-v1
  // UI hint only as of knowledge-check-integrity-v1 — mark_watched() is the
  // real gate now. This stays so the "Mark complete" control still shows as
  // disabled/enabled at the right moment instead of always being clickable
  // and failing silently against the server.
  function watchGateOk(it) {
    if (!it) return true;
    if (it.type === "video_series") {
      // Every step with a known duration must be watched; unknown-duration steps pass.
      return (it.steps || []).every((s) => {
        const dur = Number(s.duration_seconds) || 0;
        if (dur <= 0) return true;
        return (Number(stepProgress[s.id]) || 0) >= dur * WATCH_THRESHOLD;
      });
    }
    if (it.type !== "video") return true;
    const dur = Number(it.duration_seconds) || 0;
    if (dur <= 0) return true; // fail open — duration not captured yet
    return (Number(videoProgress[it.id]) || 0) >= dur * WATCH_THRESHOLD;
  }
  function watchPct(it) {
    const dur = Number(it?.duration_seconds) || 0;
    if (dur <= 0) return null;
    return Math.min(100, Math.round((100 * (Number(videoProgress[it.id]) || 0)) / dur));
  }

  function go(d) {
    setCurrent((c) => Math.min(items.length - 1, Math.max(0, c + d)));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function jump(idx) {
    setCurrent(idx);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function enterItem(idx) {
    setCurrent(idx);
    setView("lesson");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function backToMap() {
    setView("map");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function goStep(it, d) {
    const steps = it.steps || [];
    setSeriesStep((prev) => {
      const cur = prev[it.id] ?? 0;
      const next = Math.min(steps.length - 1, Math.max(0, cur + d));
      return { ...prev, [it.id]: next };
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // @feature: knowledge-check-integrity-v1 (2026-08-31)
  // Marking a plain `video` item complete now goes through mark_watched() --
  // CRIT-4 named this as the same client-writable-completions hole as the
  // quiz one. RLS no longer grants a direct INSERT into completions for
  // type='video' (or 'knowledge_check'), so the old upsert path would just
  // fail silently for those two types now; video_series and project_video
  // are unchanged here -- a separate, already-flagged gap.
  async function toggleComplete(it) {
    if (completed.has(it.id)) {
      await supabase.from("completions").delete().eq("enrollment_id", enr.id).eq("item_id", it.id);
      setCompleted((prev) => {
        const n = new Set(prev);
        n.delete(it.id);
        return n;
      });
      return;
    }
    if (it.type === "video") {
      const { data: ok } = await supabase.rpc("mark_watched", {
        p_enrollment_id: enr.id,
        p_item_id: it.id,
      });
      if (!ok) return; // gate not actually met server-side; UI hint was wrong or stale
      setCompleted((prev) => new Set(prev).add(it.id));
      return;
    }
    await supabase
      .from("completions")
      .upsert({ enrollment_id: enr.id, item_id: it.id }, { onConflict: "enrollment_id,item_id", ignoreDuplicates: true });
    setCompleted((prev) => new Set(prev).add(it.id));
  }

  // @feature: project-render-fix-v1
  // The live submit-confirm. Inserts the project_submissions row that RLS keys
  // the gated solution files off, then refetches this item's files and solutions
  // so the newly-released rows appear without a page reload.
  async function confirmAttempt(it) {
    if (projectSubs.has(it.id) || subBusy) return;
    setSubBusy(it.id);
    setSubError(null);
    const { error } = await supabase
      .from("project_submissions")
      // unlocked_by_staff is passed explicitly rather than left to a column
      // default: the INSERT policy's WITH CHECK requires `unlocked_by_staff =
      // false`, and a NULL would evaluate to NULL (not TRUE) and be denied.
      .insert({ enrollment_id: enr.id, item_id: it.id, unlocked_by_staff: false });
    if (error) {
      setSubError(error.message || "Couldn't record that. Try again, or let staff know.");
      setSubBusy(null);
      return;
    }
    setProjectSubs((prev) => new Set(prev).add(it.id));
    const [{ data: f }, { data: s }] = await Promise.all([
      supabase.from("item_files").select("*").eq("item_id", it.id).order("position"),
      supabase.from("item_solutions").select("*").eq("item_id", it.id).order("position"),
    ]);
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, files: f || x.files, solutions: s || x.solutions } : x))
    );
    setSubBusy(null);
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
  // @feature: knowledge-check-integrity-v1 (2026-08-31) — CRIT-4
  // Scoring moved server-side into grade_quiz_attempt(). The client no longer
  // computes a score or writes quiz_scores/quiz_responses directly (RLS no
  // longer grants it INSERT on either table); it hands over the raw picks and
  // renders whatever the RPC returns. answer_index for the post-submit review
  // only ever exists in this component after this call returns, and only when
  // the item's reveal_answers allows it.
  async function submitCheck(it) {
    const picks = answersRef.current[it.id] || {};
    const responses = it.questions.map((q) => ({
      question_id: q.id,
      selected_index: picks[q.id] ?? -1,
    }));
    const { data, error } = await supabase.rpc("grade_quiz_attempt", {
      p_enrollment_id: enr.id,
      p_item_id: it.id,
      p_responses: responses,
    });
    if (error) {
      setSubError(error.message || "Couldn't submit. Try again, or let staff know.");
      return;
    }
    const { score, total, results } = data;
    setSubmitted((prev) => ({ ...prev, [it.id]: { score, total } }));
    setRevealed((prev) => ({
      ...prev,
      [it.id]: Object.fromEntries((results || []).map((r) => [r.question_id, r.answer_index])),
    }));
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
      await supabase.from("quiz_responses").delete().eq("enrollment_id", enr.id).eq("item_id", it.id);
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
    setRevealed((prev) => {
      const n = { ...prev };
      delete n[it.id];
      return n;
    });
    setAnswers((prev) => ({ ...prev, [it.id]: {} }));
  }

  // @feature: file-download-tracking-v1 (2026-08-13)
  // Records that a file was actually opened, into public.file_downloads.
  // Append-only: a repeat download is a real event, so there is no dedupe and no
  // upsert.
  //
  // Fire-and-forget, and that is the deliberate part. The signed URL has already
  // been minted and the window already opened by the time this runs, so a failed
  // insert costs one data point while a thrown error would cost the student their
  // file. The table exists for product signal — is the drill workbook being
  // opened at all — not for integrity, so the asymmetry is the right way round.
  // Not awaited by callers for the same reason.
  //
  // itemId null means the bootcamp-level drill workbook rather than an item file.
  async function logDownload(path, itemId = null) {
    if (!enr || !path) return;
    try {
      await supabase
        .from("file_downloads")
        .insert({ enrollment_id: enr.id, item_id: itemId, path });
    } catch {
      // Swallowed on purpose — see above. A missing row is a lost data point,
      // never a broken download.
    }
  }

  async function downloadWorkbook() {
    const { data } = await supabase.storage.from("workbooks").createSignedUrl(bc.workbook_path, 3600);
    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
      // Logged only inside this branch: the row means "a download happened",
      // not "a button was clicked". A failed signed-URL mint is not a download.
      logDownload(bc.workbook_path, null);
    }
  }
  // @feature: project-render-fix-v1 — any file attached to an item.
  // itemId added by file-download-tracking-v1 so the log row can say which item
  // the file belonged to; every call site has the item in scope already.
  async function downloadFile(path, itemId = null) {
    const { data } = await supabase.storage.from("workbooks").createSignedUrl(path, 3600);
    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
      logDownload(path, itemId);
    }
  }

  // Shared completion control. `allowed` false renders it visibly inert with an
  // explanation, rather than hiding it — a control that vanishes reads as a bug.
  function completeRow(it, done, allowed, reason) {
    const clickable = done || allowed;
    return (
      <>
        <div
          className="complete-row"
          onClick={() => (clickable ? toggleComplete(it) : null)}
          style={clickable ? undefined : { opacity: 0.5, cursor: "not-allowed" }}
          aria-disabled={!clickable}
        >
          <span className={`check ${done ? "on" : ""}`}>{done ? "✓" : ""}</span>
          {done ? "Completed" : "Mark complete"}
        </div>
        {!clickable && reason ? (
          <div className="note" style={{ marginTop: 6, maxWidth: 520 }}>
            {reason}
          </div>
        ) : null}
      </>
    );
  }

  // @feature: project-render-fix-v1
  // Student-facing project view. Mirrors PreviewPlayer's layout, with two
  // differences: the confirm button actually writes, and gated content is shown
  // only once a submission exists (staff get an RLS exemption; students don't).
  function renderProject(it, done) {
    const resources = (it.files || []).filter((f) => !f.gated);
    const gatedFiles = (it.files || []).filter((f) => f.gated);
    const confirmed = projectSubs.has(it.id);
    const hasGatedContent = gatedFiles.length > 0 || (it.solutions || []).length > 0;
    return (
      <>
        {it.intro_text ? (
          <div className="drill" style={{ whiteSpace: "pre-wrap" }}>
            {it.intro_text}
          </div>
        ) : null}

        {resources.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0 4px" }}>
            {resources.map((f) => (
              <button key={f.id} className="btn ghost sm" onClick={() => downloadFile(f.path, it.id)}>
                ↓ {f.label || f.path.split("/").pop()}
              </button>
            ))}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 16,
            padding: 16,
            border: "1px solid var(--line-d)",
            borderRadius: "var(--r)",
            background: "var(--wash)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Solution walkthrough</div>
          {confirmed ? (
            <p className="note" style={{ marginBottom: 4, maxWidth: 520 }}>
              Attempt confirmed — the walkthrough is unlocked below.
            </p>
          ) : (
            <>
              <p className="note" style={{ marginBottom: 12, maxWidth: 520 }}>
                Confirm you&rsquo;ve attempted the build and the walkthrough unlocks below. It&rsquo;s
                withheld at the database level until you do, so it can&rsquo;t be found by digging
                around the page. Nothing is uploaded and nothing needs reviewing.
              </p>
              <button
                className="btn pri sm"
                disabled={subBusy === it.id}
                onClick={() => confirmAttempt(it)}
              >
                {subBusy === it.id ? "Saving…" : "I\u2019ve completed my attempt"}
              </button>
              {subError ? (
                <div className="notice error" style={{ marginTop: 10, fontSize: 13 }}>
                  {subError}
                </div>
              ) : null}
            </>
          )}
        </div>

        {confirmed && hasGatedContent ? (
          <div style={{ margin: "14px 0 4px" }}>
            {gatedFiles.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                {gatedFiles.map((f) => (
                  <button key={f.id} className="btn ghost sm" onClick={() => downloadFile(f.path, it.id)}>
                    ↓ {f.label || f.path.split("/").pop()}
                  </button>
                ))}
              </div>
            ) : null}
            {(it.solutions || []).map((s) =>
              s.url ? (
                <a key={s.id} className="sol-link" href={s.url} target="_blank" rel="noreferrer">
                  ▸ {s.title || "Solution walkthrough"}
                </a>
              ) : null
            )}
          </div>
        ) : null}

        {completeRow(
          it,
          done,
          confirmed,
          "Confirm your attempt above before marking the project complete."
        )}
      </>
    );
  }

  // @feature: project-render-fix-v1 — series were never rendered here at all.
  function renderSeries(it, done) {
    const steps = it.steps || [];
    const si = Math.min(seriesStep[it.id] ?? 0, Math.max(0, steps.length - 1));
    const s = steps[si];
    const stepVideoId = s ? ytVideoId(s.video_url) : null;
    return (
      <>
        {it.intro_text ? (
          <div className="drill" style={{ whiteSpace: "pre-wrap" }}>
            {it.intro_text}
          </div>
        ) : null}

        {(it.files || []).length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0 4px" }}>
            {(it.files || []).map((f) => (
              <button key={f.id} className="btn ghost sm" onClick={() => downloadFile(f.path, it.id)}>
                ↓ {f.label || f.path.split("/").pop()}
              </button>
            ))}
          </div>
        ) : null}

        {it.solutions && it.solutions.length ? (
          <div style={{ margin: "6px 0 12px" }}>
            {it.solutions.map((r) =>
              r.url ? (
                <a key={r.id} className="sol-link" href={r.url} target="_blank" rel="noreferrer">
                  ▸ {r.title || "Resource"}
                </a>
              ) : null
            )}
          </div>
        ) : null}

        {steps.length === 0 ? (
          <div className="stub">No steps in this series yet.</div>
        ) : (
          <>
            <h3 className="lesson-h" style={{ fontSize: 18, margin: "14px 0 8px" }}>
              {s.title || `Step ${si + 1}`}
            </h3>
            {stepVideoId ? (
              <div className="embed" key={`yt-step-wrap-${s.id}`}>
                <div id={`yt-step-${s.id}`} className="yt-host" />
              </div>
            ) : (
              <div className="embed-ph">
                <span>Video coming soon</span>
              </div>
            )}
            {s.solution_url ? (
              <div style={{ margin: "6px 0 4px" }}>
                <a className="sol-link" href={s.solution_url} target="_blank" rel="noreferrer">
                  ▸ {s.solution_title || `Step ${si + 1} solution`}
                </a>
              </div>
            ) : null}
            <div className="player-nav" style={{ marginTop: 12 }}>
              <button className="btn ghost" disabled={si === 0} onClick={() => goStep(it, -1)}>
                ← Previous Step
              </button>
              <span className="note">
                Step {si + 1} of {steps.length}
              </span>
              <button className="btn pri" disabled={si === steps.length - 1} onClick={() => goStep(it, 1)}>
                Next Step →
              </button>
            </div>
          </>
        )}

        {completeRow(
          it,
          done,
          watchGateOk(it),
          "Work through each step of the series before marking it complete."
        )}
      </>
    );
  }

  // Tile-map course entry screen: shown first when opening a bootcamp.
  // Every item is always clickable (locked decision: free navigation, no
  // sequential locking) — the map is just a different layout for the same
  // click-to-jump behavior the sidebar list already has.
  function renderMap() {
    return (
      <div>
        <button className="btn link" onClick={() => router.push("/learn")}>
          ← All bootcamps
        </button>
        <div style={{ margin: "14px 0 22px" }}>
          {bc?.audience ? <span className="badge b-aud">{bc.audience}</span> : null}
          <h2 className="player-title" style={{ margin: "8px 0 10px" }}>{bc?.name}</h2>
          <div className="pbar" style={{ maxWidth: 420 }}>
            <div className="pbar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="note" style={{ margin: "8px 0 0" }}>{pct}% complete</div>
          {bc?.description ? (
            <div
              className="note"
              style={{ whiteSpace: "pre-wrap", margin: "12px 0 0", maxWidth: 620, lineHeight: 1.55 }}
            >
              {bc.description}
            </div>
          ) : null}
          {/* @feature: workbook-on-map-v1 (2026-08-13)
              The workbook button used to exist only in the lesson sidebar, so it
              was unreachable from this screen — the one students land on, and the
              one whose own description says the workbook is required. The map was
              contradicting itself, and a workbook that is hard to find would also
              have depressed the download signal that file-download-tracking-v1
              just started measuring, making a placement problem look like a
              usage problem.

              Placed directly under the description so it answers the "Required:
              ... the drill workbook" line that sits immediately above it. The
              sidebar copy stays — it is genuinely useful mid-lesson, and both
              call the same function, so this is one mechanism with two entry
              points rather than two mechanisms. */}
          {bc?.workbook_path ? (
            <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={downloadWorkbook}>
              ↓ Download drill workbook
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <div className="stub">No content in this bootcamp yet.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 14,
            }}
          >
            {items.map((it, idx) => {
              const done = completed.has(it.id);
              const score = submitted[it.id];
              return (
                <div
                  key={it.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => enterItem(idx)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") enterItem(idx);
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 8,
                    minHeight: 112,
                    padding: 14,
                    borderRadius: "var(--r)",
                    border: `1px solid ${done ? "var(--indigo)" : "var(--line-d)"}`,
                    background: done ? "var(--indigo-t)" : "var(--wash)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="note" style={{ fontSize: 11 }}>
                      {idx + 1} · {kindShort(it.type)}
                    </span>
                    <span className={`navcheck ${done ? "done" : ""}`}>{done ? "✓" : ""}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.35, color: "var(--ink)" }}>
                    {it.title}
                  </div>
                  {score ? (
                    <div className="note" style={{ fontSize: 12 }}>
                      {score.score}/{score.total}
                    </div>
                  ) : null}
                  {it.type === "video_series" && (it.steps || []).length ? (
                    <div className="note" style={{ fontSize: 12 }}>
                      {(it.steps || []).length} steps
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderItem(it) {
    const done = completed.has(it.id);
    const videoId = ytVideoId(it.video_url);
    const res = submitted[it.id];
    const att = attempts[it.id];
    const notStartedTimed = it.type === "knowledge_check" && it.timed && !att && !res;
    const timedActive = it.type === "knowledge_check" && it.timed && !!att && !res;
    let remainingMs = null;
    if (timedActive) {
      const deadline = new Date(att.started_at).getTime() + (it.time_limit_minutes || 30) * 60000;
      remainingMs = Math.max(0, deadline - nowTs);
    }
    const wp = watchPct(it);
    // @feature: baseline-check-integrity-v1
    // Per-item, defaulting open: a missing or null column (an older row, or a
    // deploy where the migration hasn't run yet) behaves exactly as before.
    const revealAnswers = it.reveal_answers !== false;
    const allowRetake = it.allow_retake !== false;
    return (
      <div className="lesson">
        <div className="lesson-kind">{kindLong(it.type)}</div>
        <h2 className="lesson-h">{it.title}</h2>

        {/* @feature: project-render-fix-v1 — series and projects each get their
            own branch; previously both fell through to the plain video branch
            below, which is why projects showed an empty player. */}
        {it.type === "video_series" && renderSeries(it, done)}

        {it.type === "project_video" && renderProject(it, done)}

        {it.type === "video" && (
          <>
            {videoId ? (
              <div className="embed" key={`yt-wrap-${it.id}`}>
                <div id={`yt-${it.id}`} className="yt-host" />
              </div>
            ) : (
              <div className="embed-ph">
                <span>Video coming soon</span>
              </div>
            )}
            {it.intro_text ? (
              <div className="drill" style={{ whiteSpace: "pre-wrap" }}>
                {it.intro_text}
              </div>
            ) : null}
            {(it.files || []).length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0 4px" }}>
                {(it.files || []).map((f) => (
                  <button key={f.id} className="btn ghost sm" onClick={() => downloadFile(f.path, it.id)}>
                    ↓ {f.label || f.path.split("/").pop()}
                  </button>
                ))}
              </div>
            ) : null}
            {it.drill_text ? <div className="drill">{it.drill_text}</div> : null}
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
            {completeRow(
              it,
              done,
              watchGateOk(it),
              wp != null
                ? `Watch the video through to mark this complete. You\u2019re ${wp}% of the way through.`
                : "Watch the video through to mark this complete."
            )}
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
                      // @feature: baseline-check-integrity-v1 — a check with
                      // reveal_answers false scores silently. Without this, one
                      // blind submission hands over the complete key.
                      // @feature: knowledge-check-integrity-v1 (2026-08-31) —
                      // answer_index comes from the graded RPC response now,
                      // never from the initial questions fetch.
                      const revealedAnswerIdx = (revealed[it.id] || {})[q.id];
                      if (res && revealAnswers) {
                        if (revealedAnswerIdx != null && oi === revealedAnswerIdx) cls += " correct";
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
                    You scored {res.score} / {res.total}.
                    {revealAnswers
                      ? " Correct answers are highlighted in green."
                      : " This one's a baseline check, so the answers aren't shown and it's taken once only."}
                  </div>
                  {allowRetake ? (
                    <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => retake(it)}>
                      Retake
                    </button>
                  ) : null}
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

  if (view === "map") {
    return renderMap();
  }

  return (
    <div>
      <button className="btn link" onClick={backToMap}>
        ← Course map
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
          {bc?.description ? (
            <div
              className="note"
              style={{
                whiteSpace: "pre-wrap",
                margin: "0 0 14px",
                paddingBottom: 14,
                borderBottom: "1px solid var(--line-d)",
                lineHeight: 1.55,
              }}
            >
              {bc.description}
            </div>
          ) : null}
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
                <button className="btn pri" onClick={backToMap}>
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
