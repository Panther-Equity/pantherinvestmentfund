"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

const TYPE_LABEL = {
  knowledge_check: "Knowledge check",
  video: "Video + drill",
  project_video: "Project video",
};

function makeItem(type) {
  const base = { id: crypto.randomUUID(), type, title: "", solutions: [], questions: [] };
  if (type === "video")
    return {
      ...base,
      title: "New video",
      video_url: "",
      duration_seconds: null, // @feature: time-based-progress-v1
      urlTouched: false,
      drill_text: "Now complete problems __ through __ in the workbook.",
    };
  if (type === "project_video")
    return { ...base, title: "New project video", video_url: "", duration_seconds: null, urlTouched: false };
  return {
    ...base,
    title: "New knowledge check",
    timed: false,
    time_limit_minutes: 30,
    questions: [
      { id: crypto.randomUUID(), prompt: "", options: ["", "", "", ""], answer_index: 0 },
    ],
  };
}

export default function BootcampBuilder({ id }) {
  const supabase = createClient();
  const router = useRouter();
  const isNew = id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [bc, setBc] = useState({
    id: isNew ? crypto.randomUUID() : id,
    name: "",
    audience: "",
    workbook_path: null,
  });
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: b, error: be } = await supabase
      .from("bootcamps")
      .select("*")
      .eq("id", id)
      .single();
    if (be || !b) {
      setError("Couldn't load this bootcamp.");
      setLoading(false);
      return;
    }
    setBc({ id: b.id, name: b.name, audience: b.audience || "", workbook_path: b.workbook_path });

    const { data: its } = await supabase
      .from("items")
      .select("*")
      .eq("bootcamp_id", id)
      .order("position");
    const itemIds = (its || []).map((i) => i.id);

    let qs = [];
    let sols = [];
    if (itemIds.length) {
      const [{ data: q }, { data: s }] = await Promise.all([
        supabase.from("questions").select("*").in("item_id", itemIds).order("position"),
        supabase.from("item_solutions").select("*").in("item_id", itemIds).order("position"),
      ]);
      qs = q || [];
      sols = s || [];
    }

    setItems(
      (its || []).map((it) => ({
        id: it.id,
        type: it.type,
        title: it.title,
        timed: it.timed ?? false,
        time_limit_minutes: it.time_limit_minutes ?? 30,
        video_url: it.video_url || "",
        drill_text: it.drill_text || "",
        duration_seconds: it.duration_seconds ?? null, // @feature: time-based-progress-v1
        urlTouched: false, // @feature: time-based-progress-v1 — grandfathers in existing videos; only edits/new items get checked
        solutions: sols
          .filter((s) => s.item_id === it.id)
          .map((s) => ({ id: s.id, title: s.title, url: s.url })),
        questions: qs
          .filter((q) => q.item_id === it.id)
          .map((q) => ({
            id: q.id,
            prompt: q.prompt,
            options: q.options || ["", "", "", ""],
            answer_index: q.answer_index,
          })),
      }))
    );
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => {
    if (!isNew) load();
  }, [isNew, load]);

  const updItem = (i, patch) =>
    setItems((arr) => arr.map((it, x) => (x === i ? { ...it, ...patch } : it)));
  const moveItem = (i, d) =>
    setItems((arr) => {
      const j = i + d;
      if (j < 0 || j >= arr.length) return arr;
      const copy = [...arr];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const delItem = (i) => setItems((arr) => arr.filter((_, x) => x !== i));
  // New video/project blocks slot in *above* a trailing knowledge check (the post-course check).
  const addItem = (type) =>
    setItems((arr) => {
      const ni = makeItem(type);
      if (arr.length && type !== "knowledge_check" && arr[arr.length - 1].type === "knowledge_check") {
        const copy = [...arr];
        copy.splice(arr.length - 1, 0, ni);
        return copy;
      }
      return [...arr, ni];
    });
  const setSolutions = (i, sols) => updItem(i, { solutions: sols });
  const setQuestions = (i, qs) => updItem(i, { questions: qs });

  async function uploadWorkbook(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const path = `${bc.id}/${file.name}`;
    const { error: ue } = await supabase.storage
      .from("workbooks")
      .upload(path, file, { upsert: true });
    setUploading(false);
    if (ue) {
      setError(`Upload failed: ${ue.message}`);
      return;
    }
    setBc((b) => ({ ...b, workbook_path: path }));
    setMsg("Workbook attached (remember to Save).");
  }

  async function save() {
    // @feature: time-based-progress-v1
    // Block the save ("publish") entirely if any video/project item has a URL
    // but no captured duration — either it's brand new, or its URL was just
    // edited (which clears duration_seconds locally, see the video_url input
    // above). This runs before any network call, so nothing partial gets saved.
    const missingDuration = items.filter(
      (it) =>
        (it.type === "video" || it.type === "project_video") &&
        it.video_url &&
        !it.duration_seconds &&
        it.urlTouched
    );
    if (missingDuration.length) {
      setMsg("");
      setError(
        <>
          <strong>
            Can&rsquo;t save — {missingDuration.length} video{missingDuration.length === 1 ? "" : "s"} missing
            length data.
          </strong>
          <div style={{ marginTop: 6 }}>
            I know this is a tedious step, but since these are YouTube recordings, the only way to learn a
            video&rsquo;s length is to open it once. Go into <strong>Preview</strong> and let each of these load
            for a few seconds, then come back and save again:
          </div>
          <ul style={{ margin: "8px 0 0 18px" }}>
            {missingDuration.map((it) => (
              <li key={it.id}>{it.title || "(untitled)"}</li>
            ))}
          </ul>
        </>
      );
      return;
    }

    setSaving(true);
    setError("");
    setMsg("");
    try {
      if (!bc.name.trim()) throw new Error("Give the bootcamp a name first.");
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: e1 } = await supabase.from("bootcamps").upsert({
        id: bc.id,
        name: bc.name.trim(),
        audience: bc.audience.trim(),
        workbook_path: bc.workbook_path,
        created_by: user.id,
      });
      if (e1) throw e1;

      const itemRows = items.map((it, i) => ({
        id: it.id,
        bootcamp_id: bc.id,
        type: it.type,
        title: it.title,
        position: i,
        weight: it.type === "project_video" ? 2 : 1,
        video_url: it.type === "knowledge_check" ? null : it.video_url || null,
        drill_text: it.type === "video" ? it.drill_text || null : null,
        timed: it.type === "knowledge_check" ? !!it.timed : false,
        time_limit_minutes:
          it.type === "knowledge_check" ? Number(it.time_limit_minutes) || 30 : 30,
      }));
      if (itemRows.length) {
        const { error: e2 } = await supabase.from("items").upsert(itemRows);
        if (e2) throw e2;
      }

      // Remove items that were deleted from the list.
      const itemIds = items.map((it) => it.id);
      let del = supabase.from("items").delete().eq("bootcamp_id", bc.id);
      if (itemIds.length) del = del.not("id", "in", `(${itemIds.join(",")})`);
      const { error: e3 } = await del;
      if (e3) throw e3;

      // Rewrite questions + solutions for the current items.
      if (itemIds.length) {
        const { error: eqd } = await supabase.from("questions").delete().in("item_id", itemIds);
        if (eqd) throw eqd;
        const { error: esd } = await supabase
          .from("item_solutions")
          .delete()
          .in("item_id", itemIds);
        if (esd) throw esd;

        const qRows = [];
        const sRows = [];
        items.forEach((it) => {
          if (it.type === "knowledge_check")
            (it.questions || []).forEach((q, qi) =>
              qRows.push({
                item_id: it.id,
                prompt: q.prompt,
                options: q.options,
                answer_index: q.answer_index,
                position: qi,
              })
            );
          if (it.type === "video")
            (it.solutions || []).forEach((s, si) =>
              sRows.push({ item_id: it.id, title: s.title, url: s.url, position: si })
            );
        });
        if (qRows.length) {
          const { error: eq } = await supabase.from("questions").insert(qRows);
          if (eq) throw eq;
        }
        if (sRows.length) {
          const { error: es } = await supabase.from("item_solutions").insert(sRows);
          if (es) throw es;
        }
      }

      setMsg("Saved. Your changes are live.");
      if (isNew) router.replace(`/admin/bootcamps/${bc.id}`);
    } catch (err) {
      setError(err?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="stub">Loading…</div>;

  const workbookName = bc.workbook_path ? bc.workbook_path.split("/").pop() : null;

  return (
    <div>
      <button className="btn link" onClick={() => router.push("/admin/bootcamps")}>
        ← Back to bootcamps
      </button>
      <h1 className="h1" style={{ marginTop: 8 }}>
        {isNew ? "New bootcamp" : "Edit bootcamp"}
      </h1>

      {error && (
        <div className="notice error" style={{ maxWidth: 640 }}>
          {error}
        </div>
      )}
      {msg && (
        <div className="notice ok" style={{ maxWidth: 640 }}>
          {msg}
        </div>
      )}

      <div className="card" style={{ margin: "16px 0 20px" }}>
        <div className="row">
          <div className="field">
            <label>Bootcamp name</label>
            <input
              className="input"
              value={bc.name}
              onChange={(e) => setBc({ ...bc, name: e.target.value })}
              placeholder="Intro to DCF"
            />
          </div>
          <div className="field">
            <label>Audience label</label>
            <input
              className="input"
              value={bc.audience}
              onChange={(e) => setBc({ ...bc, audience: e.target.value })}
              placeholder="Senior Analysts"
            />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Drill workbook (Excel file)</label>
          {workbookName && (
            <div className="attach">
              {workbookName}
              <button
                className="x"
                title="Remove"
                onClick={() => setBc({ ...bc, workbook_path: null })}
              >
                ✕
              </button>
            </div>
          )}
          <label className="btn ghost sm" style={{ cursor: "pointer" }}>
            {uploading ? "Uploading…" : workbookName ? "Replace file" : "Attach .xlsx file"}
            <input
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={uploadWorkbook}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      <b className="serif" style={{ fontSize: 16 }}>
        Course items
      </b>
      <span className="note" style={{ marginLeft: 8 }}>
        videos &amp; checks weight 1, projects weight 2 · reorder with the arrows
      </span>

      <div style={{ marginTop: 12 }}>
        {items.map((it, i) => (
          <div className="itemrow" key={it.id}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="itemtype">
                {TYPE_LABEL[it.type]}
                {it.type === "project_video" ? " · weight 2" : ""}
              </div>
              <input
                className="input titleinput"
                value={it.title}
                onChange={(e) => updItem(i, { title: e.target.value })}
                placeholder="Title"
              />

              {(it.type === "video" || it.type === "project_video") && (
                <input
                  className="input subfield"
                  value={it.video_url}
                  onChange={(e) => updItem(i, { video_url: e.target.value, duration_seconds: null, urlTouched: true })}
                  placeholder="Paste unlisted YouTube link"
                />
              )}

              {it.type === "video" && (
                <input
                  className="input subfield"
                  value={it.drill_text}
                  onChange={(e) => updItem(i, { drill_text: e.target.value })}
                  placeholder="Drill instruction, e.g. Now complete problems 1–4"
                />
              )}

              {it.type === "video" && (
                <div style={{ marginTop: 6 }}>
                  {(it.solutions || []).map((s, si) => (
                    <div className="sol" key={s.id || si}>
                      <input
                        className="input"
                        placeholder="Solution label"
                        value={s.title}
                        onChange={(e) =>
                          setSolutions(
                            i,
                            it.solutions.map((x, y) => (y === si ? { ...x, title: e.target.value } : x))
                          )
                        }
                      />
                      <input
                        className="input"
                        placeholder="Solution YouTube link"
                        value={s.url}
                        onChange={(e) =>
                          setSolutions(
                            i,
                            it.solutions.map((x, y) => (y === si ? { ...x, url: e.target.value } : x))
                          )
                        }
                      />
                      <button
                        className="iconbtn danger"
                        title="Remove solution"
                        onClick={() => setSolutions(i, it.solutions.filter((_, y) => y !== si))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn link"
                    style={{ fontSize: 12 }}
                    onClick={() =>
                      setSolutions(i, [
                        ...(it.solutions || []),
                        { id: crypto.randomUUID(), title: "", url: "" },
                      ])
                    }
                  >
                    + Add solution video (optional)
                  </button>
                </div>
              )}

              {it.type === "knowledge_check" && (
                <div className="qeditor">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!it.timed}
                        onChange={(e) => updItem(i, { timed: e.target.checked })}
                      />
                      Timed check
                    </label>
                    {it.timed && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={180}
                          value={it.time_limit_minutes}
                          onChange={(e) => updItem(i, { time_limit_minutes: e.target.value })}
                          style={{ width: 72 }}
                        />
                        minute limit
                      </span>
                    )}
                    <span className="note">
                      {it.timed
                        ? "Students get a Start button, then a countdown that auto-submits at zero."
                        : "Untimed — students take it freely."}
                    </span>
                  </div>
                  {(it.questions || []).map((q, qi) => (
                    <div className="qcard" key={q.id || qi}>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <textarea
                          className="input qprompt"
                          rows={2}
                          placeholder={`Question ${qi + 1}`}
                          value={q.prompt}
                          onChange={(e) =>
                            setQuestions(
                              i,
                              it.questions.map((x, y) => (y === qi ? { ...x, prompt: e.target.value } : x))
                            )
                          }
                        />
                        <button
                          className="iconbtn danger"
                          title="Remove question"
                          onClick={() => setQuestions(i, it.questions.filter((_, y) => y !== qi))}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="note" style={{ margin: "8px 0 2px" }}>
                        Click the circle to mark the correct answer.
                      </div>
                      {q.options.map((opt, oi) => (
                        <div className="opt-edit" key={oi}>
                          <button
                            className={`radio ${q.answer_index === oi ? "on" : ""}`}
                            title="Mark correct"
                            onClick={() =>
                              setQuestions(
                                i,
                                it.questions.map((x, y) => (y === qi ? { ...x, answer_index: oi } : x))
                              )
                            }
                          />
                          <input
                            className="input"
                            placeholder={`Option ${oi + 1}`}
                            value={opt}
                            onChange={(e) =>
                              setQuestions(
                                i,
                                it.questions.map((x, y) =>
                                  y === qi
                                    ? { ...x, options: x.options.map((o, z) => (z === oi ? e.target.value : o)) }
                                    : x
                                )
                              )
                            }
                          />
                          {q.options.length > 2 && (
                            <button
                              className="iconbtn danger"
                              title="Remove option"
                              onClick={() =>
                                setQuestions(
                                  i,
                                  it.questions.map((x, y) =>
                                    y === qi
                                      ? {
                                          ...x,
                                          options: x.options.filter((_, z) => z !== oi),
                                          answer_index:
                                            x.answer_index > oi
                                              ? x.answer_index - 1
                                              : x.answer_index === oi
                                              ? 0
                                              : x.answer_index,
                                        }
                                      : x
                                  )
                                )
                              }
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      {q.options.length < 6 && (
                        <button
                          className="btn link"
                          style={{ fontSize: 12 }}
                          onClick={() =>
                            setQuestions(
                              i,
                              it.questions.map((x, y) => (y === qi ? { ...x, options: [...x.options, ""] } : x))
                            )
                          }
                        >
                          + Add option
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    className="btn ghost sm"
                    onClick={() =>
                      setQuestions(i, [
                        ...(it.questions || []),
                        { id: crypto.randomUUID(), prompt: "", options: ["", "", "", ""], answer_index: 0 },
                      ])
                    }
                  >
                    + Add question
                  </button>
                </div>
              )}
            </div>

            <div className="gr">
              <button className="iconbtn" title="Move up" onClick={() => moveItem(i, -1)}>
                ↑
              </button>
              <button className="iconbtn" title="Move down" onClick={() => moveItem(i, 1)}>
                ↓
              </button>
              <button className="iconbtn danger" title="Delete item" onClick={() => delItem(i)}>
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn ghost sm" onClick={() => addItem("video")}>
          + Video + drill
        </button>
        <button className="btn ghost sm" onClick={() => addItem("knowledge_check")}>
          + Knowledge check
        </button>
        <button className="btn ghost sm" onClick={() => addItem("project_video")}>
          + Project video
        </button>
      </div>

      <div className="hr" />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn pri" onClick={save} disabled={saving || uploading}>
          {saving ? "Saving…" : "Save bootcamp"}
        </button>
        <button className="btn ghost" onClick={() => router.push("/admin/bootcamps")}>
          Back
        </button>
      </div>
    </div>
  );
}
