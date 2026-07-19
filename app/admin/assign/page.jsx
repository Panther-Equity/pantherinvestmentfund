"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

export default function AssignPage() {
  const supabase = createClient();

  const [people, setPeople] = useState([]);
  const [bootcamps, setBootcamps] = useState([]);
  const [cohorts, setCohorts] = useState([]);

  const [selPeople, setSelPeople] = useState(new Set());
  const [selBc, setSelBc] = useState(new Set());
  const [cohortId, setCohortId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [newCohort, setNewCohort] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function loadAll() {
    setLoading(true);
    const [{ data: p }, { data: b }, { data: c }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role").order("full_name", { nullsFirst: false }),
      supabase.from("bootcamps").select("id, name, audience").order("name"),
      supabase.from("cohorts").select("id, name").order("name"),
    ]);
    setPeople(p || []);
    setBootcamps(b || []);
    setCohorts(c || []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(set, setter, id) {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  }

  function selectAll(list, setter) {
    setter(new Set(list.map((x) => x.id)));
  }

  async function addCohort() {
    setErr("");
    const name = newCohort.trim();
    if (!name) return;
    const { data, error } = await supabase.from("cohorts").insert({ name }).select().single();
    if (error) {
      setErr(error.message);
      return;
    }
    setNewCohort("");
    setCohorts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setCohortId(data.id);
    setMsg(`Cohort "${name}" created.`);
  }

  async function assign() {
    setErr("");
    setMsg("");
    if (!selPeople.size || !selBc.size) {
      setErr("Pick at least one person and one bootcamp.");
      return;
    }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth?.user?.id;
      const cid = cohortId || null;
      const uids = [...selPeople];
      const bids = [...selBc];

      const { data: existing, error: exErr } = await supabase
        .from("enrollments")
        .select("user_id, bootcamp_id, cohort_id")
        .in("user_id", uids)
        .in("bootcamp_id", bids);
      if (exErr) throw exErr;

      const key = (u, b, c) => `${u}|${b}|${c || "null"}`;
      const have = new Set((existing || []).map((e) => key(e.user_id, e.bootcamp_id, e.cohort_id)));

      const rows = [];
      uids.forEach((u) =>
        bids.forEach((b) => {
          if (!have.has(key(u, b, cid))) {
            rows.push({ user_id: u, bootcamp_id: b, cohort_id: cid, deadline: deadline || null, assigned_by: me });
          }
        })
      );

      if (!rows.length) {
        setMsg("Everyone selected is already assigned to those bootcamps for this cohort — nothing to add.");
        setBusy(false);
        return;
      }

      const { error } = await supabase.from("enrollments").insert(rows);
      if (error) throw error;

      const skipped = uids.length * bids.length - rows.length;
      setMsg(`Assigned ${rows.length} enrollment${rows.length === 1 ? "" : "s"}.${skipped ? ` (${skipped} already existed.)` : ""}`);
      setSelPeople(new Set());
      setSelBc(new Set());
    } catch (e) {
      setErr(e.message || "Assign failed.");
    } finally {
      setBusy(false);
    }
  }

  const cohortName = cohortId ? cohorts.find((c) => String(c.id) === String(cohortId))?.name : null;

  return (
    <>
      <div className="eyebrow">Assign</div>
      <h1 className="h1">Assign bootcamps</h1>
      <div className="sub">Give people access to one or more bootcamps, grouped by cohort with an optional deadline.</div>

      {err && <div className="notice error" style={{ maxWidth: 680 }}>{err}</div>}
      {msg && <div className="notice ok" style={{ maxWidth: 680 }}>{msg}</div>}

      {loading ? (
        <div className="stub">Loading…</div>
      ) : (
        <>
          <div className="assign-grid">
            <div className="card">
              <div className="picklabel">
                <span>People</span>
                <button className="btn link sm" onClick={() => selectAll(people, setSelPeople)}>Select all</button>
              </div>
              <div className="picklist">
                {people.length === 0 ? (
                  <div className="note" style={{ padding: 12 }}>No people yet. They&rsquo;ll appear here once they have accounts (invites come in the next update).</div>
                ) : (
                  people.map((p) => (
                    <label className="pickrow" key={p.id}>
                      <input type="checkbox" checked={selPeople.has(p.id)} onChange={() => toggle(selPeople, setSelPeople, p.id)} />
                      <span className="pickmain">
                        {p.full_name || p.email}
                        <span className="pickmail">{p.email}</span>
                      </span>
                      <span className={`pickrole${p.role === "student" ? "" : " staff"}`}>{p.role}</span>
                    </label>
                  ))
                )}
              </div>
              <div className="note" style={{ marginTop: 8 }}>{selPeople.size} selected</div>
            </div>

            <div className="card">
              <div className="picklabel">
                <span>Bootcamps</span>
                <button className="btn link sm" onClick={() => selectAll(bootcamps, setSelBc)}>Select all</button>
              </div>
              <div className="picklist">
                {bootcamps.length === 0 ? (
                  <div className="note" style={{ padding: 12 }}>No bootcamps yet. Build one under the Bootcamps tab.</div>
                ) : (
                  bootcamps.map((b) => (
                    <label className="pickrow" key={b.id}>
                      <input type="checkbox" checked={selBc.has(b.id)} onChange={() => toggle(selBc, setSelBc, b.id)} />
                      <span className="pickmain">
                        {b.name}
                        {b.audience ? <span className="pickmail">{b.audience === "analyst" ? "Analyst track" : b.audience === "senior" ? "Senior Analyst track" : b.audience}</span> : null}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <div className="note" style={{ marginTop: 8 }}>{selBc.size} selected</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="assign-opts">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Cohort (optional)</label>
                <select className="input" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
                  <option value="">— No cohort —</option>
                  {cohorts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Deadline (optional)</label>
                <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
            </div>

            <div className="hr" />

            <div className="assign-opts">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>New cohort</label>
                <input
                  className="input"
                  placeholder="e.g. Fall 2026"
                  value={newCohort}
                  onChange={(e) => setNewCohort(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCohort(); } }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn ghost" onClick={addCohort}>Add cohort</button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 14 }}>
            <button className="btn pri" onClick={assign} disabled={busy}>
              {busy ? "Assigning…" : "Assign selected"}
            </button>
            <span className="note">
              {selPeople.size} {selPeople.size === 1 ? "person" : "people"} × {selBc.size} bootcamp{selBc.size === 1 ? "" : "s"}
              {cohortName ? ` → ${cohortName}` : ""}
            </span>
          </div>
        </>
      )}
    </>
  );
}
