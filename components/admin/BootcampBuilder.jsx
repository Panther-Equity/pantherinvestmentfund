"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

const TYPE_LABEL = {
  knowledge_check: "Knowledge check",
  video: "Video + drill",
  project_video: "Project",
  video_series: "Video series", // @feature: video-series-v1
};

// @feature: video-series-v1
function makeStep(n) {
  return {
    id: crypto.randomUUID(),
    title: `Step ${n}`,
    video_url: "",
    solution_title: "",
    solution_url: "",
  };
}

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
  // @feature: project-files-v1 — Projects carry instructions + a labelled file list.
  if (type === "project_video")
    return {
      ...base,
      title: "New project",
      video_url: "",
      duration_seconds: null,
      urlTouched: false,
      intro_text: "",
      files: [],
    };
  // @feature: video-series-v1 — one item holding an ordered run of steps.
  if (type === "video_series")
    return {
      ...base,
      title: "New video series",
      intro_text: "",
      files: [], // shared files pinned across every step
      steps: [makeStep(1)],
    };
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
    let steps = []; // @feature: video-series-v1
    let files = []; // @feature: project-files-v1
    if (itemIds.length) {
      const [{ data: q }, { data: s }, { data: st }, { data: f }] = await Promise.all([
        supabase.from("questions").select("*").in("item_id", itemIds).order("position"),
        supabase.from("item_solutions").select("*").in("item_id", itemIds).order("position"),
        supabase.from("item_steps").select("*").in("item_id", itemIds).order("position"),
        supabase.from("item_files").select("*").in("item_id", itemIds).order("position"),
      ]);
      qs = q || [];
      sols = s || [];
      steps = st || [];
      files = f || [];
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
        urlTouched: false,
        intro_text: it.intro_text || "", // series instructions / project instructions
        solutions: sols
          .filter((s) => s.item_id === it.id)
          .map((s) => ({ id: s.id, title: s.title, url: s.url })),
        // @feature: video-series-v1
        steps: steps
          .filter((s) => s.item_id === it.id)
          .map((s) => ({
            id: s.id,
            title: s.title || "",
            video_url: s.video_url || "",
            solution_title: s.solution_title || "",
            solution_url: s.solution_url || "",
          })),
        // @feature: project-files-v1
        files: files
          .filter((f) => f.item_id === it.id)
          .map((f) => ({ id: f.id, label: f.label || "", path: f.path })),
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
  // New video/project/series blocks slot in *above* a trailing knowledge check
  // (the post-course check).
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

  // @feature: video-series-v1 — step list editing
  const updStep = (i, si, patch) =>
    setItems((arr) =>
      arr.map((it, x) =>
        x === i ? { ...it, steps: it.steps.map((s, y) => (y === si ? { ...s, ...patch } : s)) } : it
      )
    );
  const moveStep = (i, si, d) =>
    setItems((arr) =>
      arr.map((it, x) => {
        if (x !== i) return it;
        const j = si + d;
        if (j < 0 || j >= it.steps.length) return it;
        const copy = [...it.steps];
        [copy[si], copy[j]] = [copy[j], copy[si]];
        return { ...it, steps: copy };
      })
    );
  const delStep = (i, si) =>
    setItems((arr) =>
      arr.map((it, x) => (x === i ? { ...it, steps: it.steps.filter((_, y) => y !== si) } : it))
    );
  const addStep = (i) =>
    setItems((arr) =>
      arr.map((it, x) =>
        x === i ? { ...it, steps: [...(it.steps || []), makeStep((it.steps?.length || 0) + 1)] } : it
      )
    );

  // @feature: project-files-v1 — file list editing
  const updFile = (i, fi, patch) =>
    setItems((arr) =>
      arr.map((it, x) =>
        x === i ? { ...it, files: it.files.map((f, y) => (y === fi ? { ...f, ...patch } : f)) } : it
      )
    );
  const moveFile = (i, fi, d) =>
    setItems((arr) =>
      arr.map((it, x) => {
        if (x !== i) return it;
        const j = fi + d;
        if (j < 0 || j >= it.files.length) return it;
        const copy = [...it.files];
        [copy[fi], copy[j]] = [copy[j], copy[fi]];
        return { ...it, files: copy };
      })
    );
  // Removes the row only. The storage object is intentionally left in the
  // bucket — cheap, and it means an accidental remove-then-Save is recoverable.
  const delFile = (i, fi) =>
    setItems((arr) =>
      arr.map((it, x) => (x === i ? { ...it, files: it.files.filter((_, y) => y !== fi) } : it))
    );

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

  // @feature: project-files-v1
  // Multi-file attach for a Project. Same `workbooks` bucket as the bootcamp
  // drill workbook, namespaced under files/<itemId>- so two items in one
  // bootcamp can't collide on filename. Label defaults to the filename and is
  // editable — that label is what students see on the download button.
  async function uploadFiles(e, i) {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    setUploading(true);
    setError("");
    const added = [];
    for (const file of list) {
      const path = `${bc.id}/files/${items[i].id}-${file.name}`;
      const { error: ue } = await supabase.storage
        .from("workbooks")
        .upload(path, file, { upsert: true });
      if (ue) {
        setUploading(false);
        setError(`Upload failed for ${file.name}: ${ue.message}`);
        return;
      }
      added.push({ id: crypto.randomUUID(), label: file.name, path });
    }
    setUploading(false);
    setItems((arr) =>
      arr.map((it, x) => (x === i ? { ...it, files: [...(it.files || []), ...added] } : it))
    );
    setMsg(`${added.length} file${added.length === 1 ? "" : "s"} attached (remember to Save).`);
    e.target.value = ""; // allow re-picking the same file after a remove
  }

  async function save() {
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

      // NOTE: duration_seconds is deliberately NOT in this payload — omitting it
      // from the upsert leaves any Preview-captured value untouched on update.
      // items.template_path is likewise omitted: deprecated by project-files-v1,
      // superseded by the item_files table.
      const itemRows = items.map((it, i) => ({
        id: it.id,
        bootcamp_id: bc.id,
        type: it.type,
        title: it.title,
        position: i,
        weight: it.type === "project_video" ? 2 : it.type === "video_series" ? 3 : 1,
        video_url: it.type === "video" ? it.video_url || null : null,
        drill_text: it.type === "video" ? it.drill_text || null : null,
        intro_text:
          it.type === "video_series" || it.type === "project_video" ? it.intro_text || null : null,
        timed: it.type === "knowledge_check" ? !!it.timed : false,
        time_limit_minutes:
          it.type === "knowledge_check" ? Number(it.time_limit_minutes) || 30 : 30,
      }));
      if (itemRows.length) {
        const { error: e2 } = await supabase.from("items").upsert(itemRows);
        if (e2) throw e2;
      }

      // Remove items that were deleted from the list. item_steps and item_files
      // rows for a deleted item go with it via ON DELETE CASCADE.
      const itemIds = items.map((it) => it.id);
      let del = supabase.from("items").delete().eq("bootcamp_id", bc.id);
      if (itemIds.length) del = del.not("id", "in", `(${itemIds.join(",")})`);
      const { error: e3 } = await del;
      if (e3) throw e3;

      // Rewrite questions, solutions, and files for the current items.
      if (itemIds.length) {
        const { error: eqd } = await supabase.from("questions").delete().in("item_id", itemIds);
        if (eqd) throw eqd;
        const { error: esd } = await supabase
          .from("item_solutions")
          .delete()
          .in("item_id", itemIds);
        if (esd) throw esd;
        const { error: efd } = await supabase.from("item_files").delete().in("item_id", itemIds);
        if (efd) throw efd;

        const qRows = [];
        const sRows = [];
        const fRows = [];
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
          // Solutions apply to videos (drill solutions), Projects (solution
          // walkthrough), and series (shared pinned resources).
          if (it.type === "video" || it.type === "project_video" || it.type === "video_series")
            (it.solutions || []).forEach((s, si) =>
              sRows.push({ item_id: it.id, title: s.title, url: s.url, position: si })
            );
          // @feature: project-files-v1 — Projects and video series both carry files.
          if (it.type === "project_video" || it.type === "video_series")
            (it.files || []).forEach((f, fi) =>
              fRows.push({ item_id: it.id, position: fi, label: f.label || "", path: f.path })
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
        if (fRows.length) {
          const { error: ef } = await supabase.from("item_files").insert(fRows);
          if (ef) throw ef;
        }
      }

      // @feature: video-series-v1
      // Steps are upserted by id (not delete-and-reinsert like questions,
      // solutions, and files) so each step keeps its stable id — student
      // step_progress rows reference those ids, and any Preview-captured
      // duration_seconds survives. duration_seconds is omitted for that reason.
      const seriesIds = items.filter((it) => it.type === "video_series").map((it) => it.id);
      const stepRows = [];
      items.forEach((it) => {
        if (it.type === "video_series")
          (it.steps || []).forEach((s, si) =>
            stepRows.push({
              id: s.id,
              item_id: it.id,
              position: si,
              title: s.title || "",
              video_url: s.video_url || null,
              solution_title: s.solution_title || null,
              solution_url: s.solution_url || null,
            })
          );
      });
      if (stepRows.length) {
        const { error: est } = await supabase.from("item_steps").upsert(stepRows);
        if (est) throw est;
      }
      // Drop steps the user removed from a series that still exists.
      if (seriesIds.length) {
        const keepIds = stepRows.map((s) => s.id);
        let dq = supabase.from("item_steps").delete().in("item_id", seriesIds);
        if (keepIds.length) dq = dq.not("id", "in", `(${keepIds.join(",")})`);
        const { error: edt } = await dq;
        if (edt) throw edt;
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

  // Shared file-attach block. Used by Project items and by video series (where
  // the files stay pinned above every step). Uploads land in the `workbooks`
  // bucket; students download via a signed URL.
  const renderFileAttach = (it, i, hint) => (
    <div style={{ marginTop: 10 }}>
      <div className="note" style={{ marginBottom: 6 }}>
        {hint}
      </div>
      {(it.files || []).map((f, fi) => (
        <div className="sol" key={f.id || fi}>
          <input
            className="input"
            value={f.label}
            onChange={(e) => updFile(i, fi, { label: e.target.value })}
            placeholder="Button label, e.g. DCF Template (Excel)"
          />
          <span
            className="note"
            style={{
              fontSize: 11,
              alignSelf: "center",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {f.path.split("/").pop()}
          </span>
          <button className="iconbtn" title="Move up" onClick={() => moveFile(i, fi, -1)}>
            ↑
          </button>
          <button className="iconbtn" title="Move down" onClick={() => moveFile(i, fi, 1)}>
            ↓
          </button>
          <button className="iconbtn danger" title="Remove file" onClick={() => delFile(i, fi)}>
            ✕
          </button>
        </div>
      ))}
      <label className="btn ghost sm" style={{ cursor: "pointer" }}>
        {uploading ? "Uploading…" : "Attach file(s)"}
        <input
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => uploadFiles(e, i)}
          disabled={uploading}
        />
      </label>
    </div>
  );

  // Shared label+URL repeater. Used for video solution walkthroughs, Project
  // solution walkthroughs, and a series' pinned shared resource links.
  const renderLinkRepeater = (it, i, opts) => (
    <div style={{ marginTop: 6 }}>
      {(it.solutions || []).map((s, si) => (
        <div className="sol" key={s.id || si}>
          <input
            className="input"
            placeholder={opts.labelPlaceholder}
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
            placeholder={opts.urlPlaceholder}
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
            title="Remove"
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
        {opts.addLabel}
      </button>
    </div>
  );

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
        videos &amp; checks weight 1, projects weight 2, series weight 3 · reorder with the arrows
      </span>

      <div style={{ marginTop: 12 }}>
        {items.map((it, i) => (
          <div className="itemrow" key={it.id}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="itemtype">
                {TYPE_LABEL[it.type]}
                {it.type === "project_video" ? " · weight 2" : ""}
                {it.type === "video_series" ? " · weight 3" : ""}
              </div>
              <input
                className="input titleinput"
                value={it.title}
                onChange={(e) => updItem(i, { title: e.target.value })}
                placeholder="Title"
              />

              {/* @feature: project-files-v1 — Project instructions */}
              {it.type === "project_video" && (
                <div className="field" style={{ margin: "8px 0 4px" }}>
                  <label>Instructions</label>
                  <textarea
                    className="input"
                    rows={5}
                    value={it.intro_text}
                    onChange={(e) => updItem(i, { intro_text: e.target.value })}
                    placeholder={
                      "1. Download the template and the raw data below\n2. Build your model\n3. Submit before checking the solution walkthrough"
                    }
                  />
                </div>
              )}

              {it.type === "video" && (
                <input
                  className="input subfield"
                  value={it.video_url}
                  onChange={(e) =>
                    updItem(i, { video_url: e.target.value, duration_seconds: null, urlTouched: true })
                  }
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

              {/* @feature: project-files-v1 — attached files */}
              {it.type === "project_video" &&
                renderFileAttach(
                  it,
                  i,
                  "Attached files — templates, raw data, anything students download to start. The label is what they see on the button."
                )}

              {/* Solution walkthrough links — videos, and Projects (gated
                  server-side until the student submits). */}
              {(it.type === "video" || it.type === "project_video") &&
                renderLinkRepeater(it, i, {
                  labelPlaceholder: "Solution label",
                  urlPlaceholder: "Solution YouTube link",
                  addLabel:
                    it.type === "project_video"
                      ? "+ Add solution video (hidden until they submit)"
                      : "+ Add solution video (optional)",
                })}

              {/* @feature: video-series-v1 — series editor */}
              {it.type === "video_series" && (
                <div className="qeditor">
                  <div className="field" style={{ marginBottom: 12 }}>
                    <label>Intro instructions (pinned above every step)</label>
                    <textarea
                      className="input"
                      rows={5}
                      value={it.intro_text}
                      onChange={(e) => updItem(i, { intro_text: e.target.value })}
                      placeholder={
                        "1. Download the template via the link below\n2. Build the model alongside the videos\n3. Use Next Step to move through the series"
                      }
                    />
                  </div>

                  {renderFileAttach(
                    it,
                    i,
                    "Shared files — pinned above every step (e.g. model template, full solution workbook)."
                  )}

                  <div className="note" style={{ margin: "14px 0 2px" }}>
                    Shared links (optional) — for anything hosted elsewhere rather than uploaded.
                  </div>
                  {renderLinkRepeater(it, i, {
                    labelPlaceholder: "Resource label",
                    urlPlaceholder: "Resource link",
                    addLabel: "+ Add shared link",
                  })}

                  <div className="hr" style={{ margin: "14px 0 10px" }} />
                  <div className="note" style={{ marginBottom: 8 }}>
                    Steps — each one gets its own video and its own step solution.
                  </div>

                  {(it.steps || []).map((s, si) => (
                    <div className="qcard" key={s.id}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 8,
                        }}
                      >
                        <span className="qnum">Step {si + 1}</span>
                        <span style={{ display: "inline-flex", gap: 4 }}>
                          <button
                            className="iconbtn"
                            title="Move up"
                            onClick={() => moveStep(i, si, -1)}
                          >
                            ↑
                          </button>
                          <button
                            className="iconbtn"
                            title="Move down"
                            onClick={() => moveStep(i, si, 1)}
                          >
                            ↓
                          </button>
                          <button
                            className="iconbtn danger"
                            title="Remove step"
                            onClick={() => delStep(i, si)}
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                      <input
                        className="input"
                        style={{ marginBottom: 6 }}
                        value={s.title}
                        onChange={(e) => updStep(i, si, { title: e.target.value })}
                        placeholder="Step title, e.g. Step 3: FCF Calculation"
                      />
                      <input
                        className="input"
                        style={{ marginBottom: 6 }}
                        value={s.video_url}
                        onChange={(e) => updStep(i, si, { video_url: e.target.value })}
                        placeholder="Paste unlisted YouTube link for this step"
                      />
                      <div className="sol">
                        <input
                          className="input"
                          value={s.solution_title}
                          onChange={(e) => updStep(i, si, { solution_title: e.target.value })}
                          placeholder="Step solution label (optional)"
                        />
                        <input
                          className="input"
                          value={s.solution_url}
                          onChange={(e) => updStep(i, si, { solution_url: e.target.value })}
                          placeholder="Step solution link (optional)"
                        />
                      </div>
                    </div>
                  ))}
                  <button className="btn ghost sm" onClick={() => addStep(i)}>
                    + Add step
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
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!it.timed}
                        onChange={(e) => updItem(i, { timed: e.target.checked })}
                      />
                      Timed check
                    </label>
                    {it.timed && (
                      <span
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
                      >
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
                                    ? {
                                        ...x,
                                        options: x.options.map((o, z) => (z === oi ? e.target.value : o)),
                                      }
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
                              it.questions.map((x, y) =>
                                y === qi ? { ...x, options: [...x.options, ""] } : x
                              )
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
          + Project
        </button>
        <button className="btn ghost sm" onClick={() => addItem("video_series")}>
          + Video series
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
