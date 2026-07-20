"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";

const COLUMNS = [
  { k: "name", label: "Name" },
  { k: "bootcamp", label: "Bootcamp" },
  { k: "cohort", label: "Cohort" },
  { k: "pct", label: "Progress" },
  { k: "deadline", label: "Deadline" },
];

export default function AdminDashboardPage() {
  const supabase = createClient();

  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [openCol, setOpenCol] = useState(null);

  const [fName, setFName] = useState("");
  const [fBootcamp, setFBootcamp] = useState("");
  const [fCohort, setFCohort] = useState("");
  const [fProgress, setFProgress] = useState("");
  const [fDeadline, setFDeadline] = useState("");

  async function load() {
    setErr("");
    const [enrRes, progRes] = await Promise.all([
      supabase
        .from("enrollments")
        .select("id, user_id, bootcamp_id, cohort_id, deadline, profiles!user_id(full_name,email), bootcamps(name), cohorts(name)"),
      supabase.from("enrollment_progress").select("enrollment_id, pct"),
    ]);

    if (enrRes.error) {
      setErr(enrRes.error.message);
      setData([]);
      return;
    }

    const enr = enrRes.data || [];
    const prog = progRes.data || [];
    const pmap = Object.fromEntries(prog.map((p) => [p.enrollment_id, p.pct]));

    const built = enr.map((e) => ({
      id: e.id,
      name: e.profiles?.full_name || e.profiles?.email || "—",
      email: e.profiles?.email || "",
      bootcamp: e.bootcamps?.name || "—",
      cohort: e.cohorts?.name || "—",
      pct: Math.round(pmap[e.id] ?? 0),
      deadline: e.deadline,
    }));

    setData(built);
  }

  useEffect(() => {
    load();
  }, []);

  const bootcampOpts = useMemo(
    () => [...new Set((data || []).map((r) => r.bootcamp))].sort((a, b) => a.localeCompare(b)),
    [data]
  );
  const cohortOpts = useMemo(
    () => [...new Set((data || []).map((r) => r.cohort))].sort((a, b) => a.localeCompare(b)),
    [data]
  );

  const anyFilter = !!(fName || fBootcamp || fCohort || fProgress || fDeadline);

  function clearFilters() {
    setFName("");
    setFBootcamp("");
    setFCohort("");
    setFProgress("");
    setFDeadline("");
  }

  function colFiltered(key) {
    return (
      (key === "name" && !!fName) ||
      (key === "bootcamp" && !!fBootcamp) ||
      (key === "cohort" && !!fCohort) ||
      (key === "pct" && !!fProgress) ||
      (key === "deadline" && !!fDeadline)
    );
  }

  function applySort(key, dir) {
    setSortKey(key);
    setSortDir(dir);
  }

  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const q = fName.trim().toLowerCase();
    return (data || []).filter((r) => {
      if (q && !`${r.name} ${r.email}`.toLowerCase().includes(q)) return false;
      if (fBootcamp && r.bootcamp !== fBootcamp) return false;
      if (fCohort && r.cohort !== fCohort) return false;
      if (fProgress === "notstarted" && r.pct !== 0) return false;
      if (fProgress === "inprogress" && !(r.pct > 0 && r.pct < 100)) return false;
      if (fProgress === "finished" && r.pct < 100) return false;
      if (fDeadline === "has" && !r.deadline) return false;
      if (fDeadline === "none" && r.deadline) return false;
      if (fDeadline === "overdue" && !(r.deadline && r.deadline < today && r.pct < 100)) return false;
      return true;
    });
  }, [data, fName, fBootcamp, fCohort, fProgress, fDeadline]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === "pct") return (a.pct - b.pct) * dir;
      if (sortKey === "deadline") {
        const av = a.deadline || "";
        const bv = b.deadline || "";
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av < bv ? -dir : av > bv ? dir : 0;
      }
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      return av.localeCompare(bv) * dir;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const stats = useMemo(() => {
    const rows = filtered;
    const n = rows.length;
    const people = new Set(rows.map((r) => r.email)).size;
    const notStarted = rows.filter((r) => r.pct === 0).length;
    const finished = rows.filter((r) => r.pct >= 100).length;
    const avg = n ? Math.round(rows.reduce((s, r) => s + r.pct, 0) / n) : 0;
    return { people, notStarted, finished, avg };
  }, [filtered]);

  function fmtDeadline(d) {
    if (!d) return "—";
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  // @feature: progress-bar-red-to-green-v1
  // 0% -> red (hue 0), 100% -> green (hue 120). Same bar shape/size, just a
  // color ramp so a glance at the roster shows who's behind vs. on track.
  function progressColor(pct) {
    const hue = Math.max(0, Math.min(100, pct)) * 1.2;
    return `hsl(${hue}, 65%, 45%)`;
  }

  function exportCsv() {
    const head = ["Name", "Email", "Bootcamp", "Cohort", "Progress %", "Deadline"];
    const lines = [head.join(",")];
    sorted.forEach((r) => {
      const cells = [r.name, r.email, r.bootcamp, r.cohort, r.pct, r.deadline || ""];
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

  function sortLabels(key) {
    if (key === "pct") return ["Lowest first", "Highest first"];
    if (key === "deadline") return ["Earliest first", "Latest first"];
    return ["A → Z", "Z → A"];
  }

  function OptionList({ current, setter, options }) {
    return options.map((o) => (
      <button
        key={o.v}
        className={`menu-item ${current === o.v ? "active" : ""}`}
        type="button"
        onClick={() => {
          setter(o.v);
          setOpenCol(null);
        }}
      >
        {o.l}
      </button>
    ));
  }

  function renderFilter(key) {
    if (key === "name") {
      return (
        <input
          className="menu-input"
          placeholder="Contains…"
          value={fName}
          autoFocus
          onChange={(e) => setFName(e.target.value)}
        />
      );
    }
    if (key === "bootcamp") {
      return (
        <OptionList
          current={fBootcamp}
          setter={setFBootcamp}
          options={[{ v: "", l: "All" }, ...bootcampOpts.map((o) => ({ v: o, l: o }))]}
        />
      );
    }
    if (key === "cohort") {
      return (
        <OptionList
          current={fCohort}
          setter={setFCohort}
          options={[{ v: "", l: "All" }, ...cohortOpts.map((o) => ({ v: o, l: o }))]}
        />
      );
    }
    if (key === "pct") {
      return (
        <OptionList
          current={fProgress}
          setter={setFProgress}
          options={[
            { v: "", l: "All" },
            { v: "notstarted", l: "Not started" },
            { v: "inprogress", l: "In progress" },
            { v: "finished", l: "Finished" },
          ]}
        />
      );
    }
    return (
      <OptionList
        current={fDeadline}
        setter={setFDeadline}
        options={[
          { v: "", l: "All" },
          { v: "overdue", l: "Overdue" },
          { v: "has", l: "Has deadline" },
          { v: "none", l: "No deadline" },
        ]}
      />
    );
  }

  function ColumnMenu({ col }) {
    const [asc, desc] = sortLabels(col.k);
    return (
      <div className="col-menu" onClick={(e) => e.stopPropagation()}>
        <div className="menu-sec">
          <div className="menu-lbl">Sort</div>
          <button
            className={`menu-item ${sortKey === col.k && sortDir === "asc" ? "active" : ""}`}
            type="button"
            onClick={() => applySort(col.k, "asc")}
          >
            {asc}
          </button>
          <button
            className={`menu-item ${sortKey === col.k && sortDir === "desc" ? "active" : ""}`}
            type="button"
            onClick={() => applySort(col.k, "desc")}
          >
            {desc}
          </button>
        </div>
        <div className="menu-sec">
          <div className="menu-lbl">Filter</div>
          {renderFilter(col.k)}
        </div>
      </div>
    );
  }

  if (data === null) return <div className="stub">Loading dashboard…</div>;

  return (
    <>
      <div className="eyebrow">Dashboard</div>
      <h1 className="h1">Progress</h1>
      <div className="sub">Who&rsquo;s been assigned what and how far they&rsquo;ve gotten.</div>

      {err && <div className="notice error">{err}</div>}

      <div className="stats">
        <div className="stat">
          <div className="stat-num">{stats.people}</div>
          <div className="stat-lbl">People</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.notStarted}</div>
          <div className="stat-lbl">Not started</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.avg}%</div>
          <div className="stat-lbl">Avg. completion</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.finished}</div>
          <div className="stat-lbl">Finished</div>
        </div>
      </div>

      <div className="toolbar">
        <span className="note">
          Showing {sorted.length} of {(data || []).length}
          {anyFilter ? (
            <>
              {" · "}
              <button className="btn link sm" type="button" onClick={clearFilters}>Clear filters</button>
            </>
          ) : null}
        </span>
        <button className="btn ghost" onClick={exportCsv} disabled={!sorted.length}>Export CSV</button>
      </div>

      {(data || []).length === 0 ? (
        <div className="stub">
          No assignments yet. Head to the <strong>Assign</strong> tab to enroll people in bootcamps.
        </div>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.k} className="th-h" style={col.k === "pct" ? { width: 240 } : undefined}>
                    <button
                      className={`th-btn ${openCol === col.k ? "open" : ""}`}
                      type="button"
                      onClick={() => setOpenCol((c) => (c === col.k ? null : col.k))}
                    >
                      {col.label}
                      <span className="hdr-marks">
                        {sortKey === col.k && <span className="sort-ind">{sortDir === "asc" ? "▲" : "▼"}</span>}
                        {colFiltered(col.k) && <span className="filter-dot" />}
                        <span className="caret">▾</span>
                      </span>
                    </button>
                    {openCol === col.k && <ColumnMenu col={col} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="dt-empty">No rows match your filters.</td>
                </tr>
              ) : (
                sorted.map((r) => (
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
                          <span className="minibar-fill" style={{ width: `${r.pct}%`, background: progressColor(r.pct) }} />
                        </span>
                        <span className="prog-pct">{r.pct}%</span>
                      </div>
                    </td>
                    <td className="dt-deadline">{fmtDeadline(r.deadline)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {openCol && <div className="menu-overlay" onClick={() => setOpenCol(null)} />}
    </>
  );
}
