"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function BootcampsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [bootcamps, setBootcamps] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState("name_asc");
  // @feature: duplicate-completeness-v1 (2026-08-14)
  // duplicate() previously ran six unchecked inserts and always reported
  // success, so a partial copy was indistinguishable from a good one.
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const { data } = await supabase
      .from("bootcamps")
      .select("id, name, audience, updated_at, items(type)")
      .order("created_at", { ascending: true });
    setBootcamps(data || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function summary(items) {
    const v = items.filter((i) => i.type === "video").length;
    const k = items.filter((i) => i.type === "knowledge_check").length;
    const p = items.some((i) => i.type === "project_video");
    return `${v} video${v === 1 ? "" : "s"} · ${k} check${k === 1 ? "" : "s"} · ${p ? "project" : "no project"}`;
  }

  function fmtWhen(t) {
    if (!t) return "";
    const d = new Date(t);
    if (isNaN(d)) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  async function remove(id, name) {
    if (
      !confirm(
        `Delete "${name}"? This removes its videos, drills, and quizzes — and any assignment/progress records for it. This can't be undone.`
      )
    )
      return;
    setBusy(true);
    setErr("");
    setMsg("");
    const { error } = await supabase.from("bootcamps").delete().eq("id", id);
    if (error) setErr(`Could not delete: ${error.message}`);
    await load();
    setBusy(false);
  }

  // @feature: duplicate-completeness-v1 (2026-08-14)
  // CRIT-7. The previous version copied bootcamps, items, questions and
  // item_solutions, and silently dropped everything else. Three classes of loss:
  //
  //   1. Whole tables. item_steps and item_files were never read, so a copied
  //      video series had no steps and a copied project had no downloads — the
  //      item rendered as an empty shell.
  //   2. Item columns. intro_text, timed, time_limit_minutes, duration_seconds,
  //      reveal_answers and allow_retake were all omitted, so they fell back to
  //      column defaults. reveal_answers and allow_retake are the worst of these:
  //      both default to true, so duplicating a blind one-shot baseline check
  //      produced a copy that shows the answer key and allows retakes. That is an
  //      integrity regression that looks completely normal on screen.
  //   3. bootcamps.description, which is rendered to students on the course map
  //      and beside every lesson.
  //
  // Every insert is now checked and the first failure aborts with a visible
  // message, because "reports success while quietly broken" was the actual
  // defect — the missing columns were how it happened, not what made it bad.
  //
  // Storage objects are deliberately NOT copied. item_files.path is carried over
  // as-is, so the copy points at the original's uploaded files. Nothing in the
  // app deletes storage objects (delFile in BootcampBuilder removes the row and
  // leaves the object), so the reference stays valid, and copying every file
  // client-side would mean a download-and-reupload round trip per file. The
  // tradeoff worth knowing: re-uploading a file on the original replaces the
  // shared object, so the copy sees the new version too.
  async function duplicate(id) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const { data: bc, error: eBc } = await supabase
        .from("bootcamps")
        .select("*")
        .eq("id", id)
        .single();
      if (eBc || !bc) throw new Error(eBc?.message || "Could not read that bootcamp.");

      const { data: items, error: eIt } = await supabase
        .from("items")
        .select("*")
        .eq("bootcamp_id", id)
        .order("position");
      if (eIt) throw new Error(eIt.message);

      const itemIds = (items || []).map((i) => i.id);

      // All four child tables, not just questions and solutions.
      let qs = [];
      let sols = [];
      let steps = [];
      let files = [];
      if (itemIds.length) {
        const [rq, rs, rst, rf] = await Promise.all([
          supabase.from("questions").select("*").in("item_id", itemIds).order("position"),
          supabase.from("item_solutions").select("*").in("item_id", itemIds).order("position"),
          supabase.from("item_steps").select("*").in("item_id", itemIds).order("position"),
          supabase.from("item_files").select("*").in("item_id", itemIds).order("position"),
        ]);
        for (const r of [rq, rs, rst, rf]) {
          if (r.error) throw new Error(r.error.message);
        }
        qs = rq.data || [];
        sols = rs.data || [];
        steps = rst.data || [];
        files = rf.data || [];
      }

      const newBcId = crypto.randomUUID();
      const { error: e1 } = await supabase.from("bootcamps").insert({
        id: newBcId,
        name: `${bc.name} (copy)`,
        audience: bc.audience,
        description: bc.description,
        workbook_path: bc.workbook_path,
      });
      if (e1) throw new Error(e1.message);

      // template_path is intentionally omitted — deprecated by project-files-v1
      // and superseded by item_files.
      const idMap = {};
      const newItems = (items || []).map((it) => {
        const nid = crypto.randomUUID();
        idMap[it.id] = nid;
        return {
          id: nid,
          bootcamp_id: newBcId,
          type: it.type,
          title: it.title,
          position: it.position,
          weight: it.weight,
          video_url: it.video_url,
          drill_text: it.drill_text,
          intro_text: it.intro_text,
          timed: it.timed,
          time_limit_minutes: it.time_limit_minutes,
          duration_seconds: it.duration_seconds,
          reveal_answers: it.reveal_answers,
          allow_retake: it.allow_retake,
        };
      });
      if (newItems.length) {
        const { error: e2 } = await supabase.from("items").insert(newItems);
        if (e2) throw new Error(e2.message);
      }

      const newQs = qs.map((q) => ({
        item_id: idMap[q.item_id],
        prompt: q.prompt,
        options: q.options,
        answer_index: q.answer_index,
        position: q.position,
      }));
      if (newQs.length) {
        const { error: e3 } = await supabase.from("questions").insert(newQs);
        if (e3) throw new Error(e3.message);
      }

      const newSols = sols.map((s) => ({
        item_id: idMap[s.item_id],
        title: s.title,
        url: s.url,
        position: s.position,
      }));
      if (newSols.length) {
        const { error: e4 } = await supabase.from("item_solutions").insert(newSols);
        if (e4) throw new Error(e4.message);
      }

      const newSteps = steps.map((s) => ({
        item_id: idMap[s.item_id],
        position: s.position,
        title: s.title,
        video_url: s.video_url,
        solution_title: s.solution_title,
        solution_url: s.solution_url,
        duration_seconds: s.duration_seconds,
      }));
      if (newSteps.length) {
        const { error: e5 } = await supabase.from("item_steps").insert(newSteps);
        if (e5) throw new Error(e5.message);
      }

      const newFiles = files.map((f) => ({
        item_id: idMap[f.item_id],
        position: f.position,
        label: f.label,
        path: f.path,
        gated: f.gated,
      }));
      if (newFiles.length) {
        const { error: e6 } = await supabase.from("item_files").insert(newFiles);
        if (e6) throw new Error(e6.message);
      }

      await load();
      setMsg(
        `Copied "${bc.name}" — ${newItems.length} item${newItems.length === 1 ? "" : "s"}, ` +
          `${newQs.length} question${newQs.length === 1 ? "" : "s"}, ` +
          `${newSteps.length} step${newSteps.length === 1 ? "" : "s"}, ` +
          `${newFiles.length} file${newFiles.length === 1 ? "" : "s"}.`
      );
    } catch (e) {
      // A failure part-way through leaves the partial copy in place rather than
      // rolling back — six separate inserts over PostgREST are not one
      // transaction. Saying so is the point: a half-copied bootcamp is visible
      // in the list and can be deleted, which is recoverable. Silently
      // reporting success was not.
      setErr(
        `${e?.message || "Could not duplicate that bootcamp."} — if a partial copy appeared in the list, delete it and try again.`
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (bootcamps === null) return <div className="stub">Loading bootcamps…</div>;

  const sorted = [...bootcamps].sort((a, b) => {
    if (sort === "name_asc") return a.name.localeCompare(b.name);
    if (sort === "name_desc") return b.name.localeCompare(a.name);
    const at = a.updated_at || "";
    const bt = b.updated_at || "";
    if (sort === "modified_asc") return at < bt ? -1 : at > bt ? 1 : 0;
    return at < bt ? 1 : at > bt ? -1 : 0; // modified_desc
  });

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="eyebrow">Content</div>
          <h1 className="h1">Bootcamps</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {bootcamps.length > 1 && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="note">Sort</span>
              <select
                className="input"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                style={{ width: "auto", paddingTop: 6, paddingBottom: 6 }}
              >
                <option value="name_asc">Name A–Z</option>
                <option value="name_desc">Name Z–A</option>
                <option value="modified_desc">Recently modified</option>
                <option value="modified_asc">Oldest modified</option>
              </select>
            </label>
          )}
          <button className="btn pri" onClick={() => router.push("/admin/bootcamps/new")}>
            + New bootcamp
          </button>
        </div>
      </div>

      {err && <div className="notice error" style={{ maxWidth: 720 }}>{err}</div>}
      {msg && <div className="notice ok" style={{ maxWidth: 720 }}>{msg}</div>}

      {bootcamps.length === 0 ? (
        <div className="stub">
          No bootcamps yet. Click <strong>New bootcamp</strong> to build your first one
          (e.g. Accounting Fundamentals).
        </div>
      ) : (
        <div className="grid cards">
          {sorted.map((b) => (
            <div className="card" key={b.id}>
              {b.audience ? <span className="badge b-aud">{b.audience}</span> : null}
              <h3 style={{ margin: "12px 0 3px" }}>{b.name}</h3>
              <div className="note">{summary(b.items || [])}</div>
              {b.updated_at ? (
                <div className="note" style={{ marginTop: 2 }}>Updated {fmtWhen(b.updated_at)}</div>
              ) : null}
              <div className="hr" />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn ghost sm" onClick={() => router.push(`/admin/bootcamps/${b.id}`)}>
                  Edit
                </button>
                <button className="btn ghost sm" onClick={() => router.push(`/admin/bootcamps/${b.id}/preview`)}>
                  Preview
                </button>
                <button className="btn ghost sm" disabled={busy} onClick={() => duplicate(b.id)}>
                  Duplicate
                </button>
                <button
                  className="btn ghost sm danger"
                  disabled={busy}
                  onClick={() => remove(b.id, b.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
