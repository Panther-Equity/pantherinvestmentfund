"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function BootcampsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [bootcamps, setBootcamps] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("bootcamps")
      .select("id, name, audience, items(type)")
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

  async function remove(id, name) {
    if (
      !confirm(
        `Delete "${name}"? This removes its videos, drills, and quizzes — and any assignment/progress records for it. This can't be undone.`
      )
    )
      return;
    setBusy(true);
    await supabase.from("bootcamps").delete().eq("id", id);
    await load();
    setBusy(false);
  }

  async function duplicate(id) {
    setBusy(true);
    const { data: bc } = await supabase.from("bootcamps").select("*").eq("id", id).single();
    const { data: items } = await supabase
      .from("items")
      .select("*")
      .eq("bootcamp_id", id)
      .order("position");
    const itemIds = (items || []).map((i) => i.id);
    const { data: qs } = itemIds.length
      ? await supabase.from("questions").select("*").in("item_id", itemIds)
      : { data: [] };
    const { data: sols } = itemIds.length
      ? await supabase.from("item_solutions").select("*").in("item_id", itemIds)
      : { data: [] };

    const newBcId = crypto.randomUUID();
    await supabase.from("bootcamps").insert({
      id: newBcId,
      name: `${bc.name} (copy)`,
      audience: bc.audience,
      workbook_path: bc.workbook_path,
    });

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
      };
    });
    if (newItems.length) await supabase.from("items").insert(newItems);

    const newQs = (qs || []).map((q) => ({
      item_id: idMap[q.item_id],
      prompt: q.prompt,
      options: q.options,
      answer_index: q.answer_index,
      position: q.position,
    }));
    if (newQs.length) await supabase.from("questions").insert(newQs);

    const newSols = (sols || []).map((s) => ({
      item_id: idMap[s.item_id],
      title: s.title,
      url: s.url,
      position: s.position,
    }));
    if (newSols.length) await supabase.from("item_solutions").insert(newSols);

    await load();
    setBusy(false);
  }

  if (bootcamps === null) return <div className="stub">Loading bootcamps…</div>;

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <div>
          <div className="eyebrow">Content</div>
          <h1 className="h1">Bootcamps</h1>
        </div>
        <button className="btn pri" onClick={() => router.push("/admin/bootcamps/new")}>
          + New bootcamp
        </button>
      </div>

      {bootcamps.length === 0 ? (
        <div className="stub">
          No bootcamps yet. Click <strong>New bootcamp</strong> to build your first one
          (e.g. Accounting Fundamentals).
        </div>
      ) : (
        <div className="grid cards">
          {bootcamps.map((b) => (
            <div className="card" key={b.id}>
              {b.audience ? <span className="badge b-aud">{b.audience}</span> : null}
              <h3 style={{ margin: "12px 0 3px" }}>{b.name}</h3>
              <div className="note">{summary(b.items || [])}</div>
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
