"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

export default function AdminDashboardPage() {
  const supabase = createClient();

  const [rows, setRows] = useState(null);
  const [cohorts, setCohorts] = useState([]);
  const [cohortFilter, setCohortFilter] = useState("all");
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    const [enrRes, progRes, kcRes, scRes, cohRes] = await Promise.all([
      supabase
        .from("enrollments")
        .select("id, user_id, bootcamp_id, cohort_id, deadline, profiles!user_id(full_name,email), bootcamps(name), cohorts(name)"),
      supabase.from("enrollment_progress").select("enrollment_id, pct"),
      supabase.from("items").select("id, bootcamp_id, title").eq("type", "knowledge_check"),
      supabase.from("quiz_scores").select("enrollment_id, item_id, score, total"),
      supabase.from("cohorts").select("id, name").order("name"),
    ]);

    if (enrRes.error) {
      setErr(enrRes.error.message);
      setRows([]);
      return;
    }

    const enr = enrRes.data || [];
    const prog = progRes.data || [];
    const kc = kcRes.data || [];
    const sc = scRes.data || [];

    const pmap = Object.fromEntries(prog.map((p) => [p.enrollment_id, p.pct]));

    const preOf = {};
    const postOf = {};
    kc.forEach((i) => {
      if (/pre/i.test(i.title)) preOf[i.bootcamp_id] = i.id;
      if (/post/i.test(i.title)) postOf[i.bootcamp_id] = i.id;
    });

    const scoreMap = {};
    sc.forEach((s) => {
      scoreMap[`${s.enrollment_id}|${s.item_id}`] = { score: s.score, total: s.total };
    });

    const built = enr.map((e) => {
      const preId = preOf[e.bootcamp_id];
      const postId = postOf[e.bootcamp_id];
      return {
        id: e.id,
        name: e.profiles?.full_name || e.profiles?.email || "—",
        email: e.profiles?.email || "",
        bootcamp: e.bootcamps?.name || "—",
        cohort: e.cohorts?.name || "—",
        cohort_id: e.cohort_id,
        pct: Math.round(pmap[e.id] ?? 0),
        pre: preId ? scoreMap[`${e.id}|${preId}`] || null : null,
        post: postId ? scoreMap[`${e.id}|${postId}`] || null : null,
        deadline: e.deadline,
      };
    });

    built.sort((a, b) => a.name.localeCompare(b.name) || a.bootcamp.localeCompare(b.bootcamp));
    setRows(built);
    setCohorts(cohRes.data || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (rows || []).filter((r) => cohortFilter === "all" || String(r.cohort_id) === String(cohortFilter)),
    [rows, cohortFilter]
  );

  const stats = useMemo(() => {
    const n = filtered.length;
    const avg = n ? Math.round(filtered.reduce((s, r) => s + r.pct, 0) / n) : 0;
    const done = filtered.filter((r) => r.pct >= 100).length;
    const people = new Set(filtered.map((r) => r.email)).size;
    return { n, avg, done, people };
  }, [filtered]);

  function fmtScore(s) {
    if (!s) return "—";
    return `${s.score}/${s.total}`;
  }

  function fmtDeadline(d) {
    if (!d) return "—";
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function exportCsv() {
    const head = ["Name", "Email", "Bootcamp", "Cohort", "Progress %", "Pre score", "Post score", "Deadline"];
    const lines = [head.join(",")];
    filtered.forEach((r) => {
      const cells = [
        r.name,
        r.email,
        r.bootcamp,
        r.cohort,
        r.pct,
        r.pre ? `${r.pre.score}/${r.pre.total}` : "",
        r.post ? `${r.post.score}/${r.post.total}` : "",
        r.deadline || "",
      ];
      lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `panther-equity-progress-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (rows === null) return <div className="stub">Loading dashboard…</div>;

  return (
    <>
      <div className="eyebrow">Dashboard</div>
      <h1 className="h1">Progress</h1>
      <div className="sub">Who&rsquo;s been assigned what, how far they&rsquo;ve gotten, and their pre / post knowledge-check scores.</div>

      {err && <div className="notice error">{err}</div>}

      <div className="stats">
        <div className="stat">
          <div className="stat-num">{stats.people}</div>
          <div className="stat-lbl">People</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.n}</div>
          <div className="stat-lbl">Assignments</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.avg}%</div>
          <div className="stat-lbl">Avg. completion</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.done}</div>
          <div className="stat-lbl">Finished</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
          <label>Cohort</label>
          <select className="input" value={cohortFilter} onChange={(e) => setCohortFilter(e.target.value)}>
            <option value="all">All cohorts</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="null">— No cohort —</option>
          </select>
        </div>
        <button className="btn ghost" onClick={exportCsv} disabled={!filtered.length}>Export CSV</button>
      </div>

      {filtered.length === 0 ? (
        <div className="stub">
          No assignments{cohortFilter === "all" ? " yet" : " in this cohort"}. Head to the <strong>Assign</strong> tab to enroll people in bootcamps.
        </div>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Bootcamp</th>
                <th>Cohort</th>
                <th style={{ width: 190 }}>Progress</th>
                <th>Pre</th>
                <th>Post</th>
                <th>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="dt-name">{r.name}</div>
                    <div className="dt-mail">{r.email}</div>
                  </td>
                  <td>{r.bootcamp}</td>
                  <td>{r.cohort}</td>
                  <td>
                    <div className="prog">
                      <span className="minibar">
                        <span className="minibar-fill" style={{ width: `${r.pct}%` }} />
                      </span>
                      <span className="prog-pct">{r.pct}%</span>
                    </div>
                  </td>
                  <td className="dt-score">{fmtScore(r.pre)}</td>
                  <td className="dt-score">{fmtScore(r.post)}</td>
                  <td className="dt-deadline">{fmtDeadline(r.deadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
