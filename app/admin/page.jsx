"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

// @feature: dashboard-grouped-by-person-v1
// The table groups one row per person; the underlying data stays per-enrollment
// (one row per person × bootcamp) so filters, the stat strip, and the CSV
// export all keep full granularity. Click a name to drill into their
// per-bootcamp breakdown on the People detail page.
const COLUMNS = [
  { k: "name", label: "Name" },
  { k: "bootcamps", label: "Bootcamps" },
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
    const [enrRes, progRes, timeProgRes] = await Promise.all([
      supabase
        .from("enrollments")
        .select("id, user_id, bootcamp_id, cohort_id, deadline, profiles!user_id(full_name,email), bootcamps(name), cohorts(name)"),
      supabase.from("enrollment_progress").select("enrollment_id, pct"),
      supabase.from("enrollment_time_progress").select("enrollment_id, time_pct"), // @feature: time-based-progress-v1
    ]);

    if (enrRes.error) {
      setErr(enrRes.error.message);
      setData([]);
      return;
    }

    const enr = enrRes.data || [];
    const prog = progRes.data || [];
    const pmap = Object.fromEntries(prog.map((p) => [p.enrollment_id, p.pct]));
    const timeProg = timeProgRes.data || [];
    // time_pct is null when nothing in the bootcamp has a known time budget yet
    // (e.g. no video durations captured, no timed knowledge checks) — kept as
    // null rather than 0 so a missing budget never reads as a real 0%.
    // No longer shown in the table (dropped 2026-08-07 — not useful at a
    // glance); still carried through to the CSV export.
    const tpmap = Object.fromEntries(timeProg.map((p) => [p.enrollment_id, p.time_pct]));

    const built = enr.map((e) => ({
      id: e.id,
      userId: e.user_id,
      name: e.profiles?.full_name || e.profiles?.email || "—",
      email: e.profiles?.email || "",
      bootcamp: e.bootcamps?.name || "—",
      cohort: e.cohorts?.name || "—",
      pct: Math.round(pmap[e.id] ?? 0),
      timePct: tpmap[e.id] == null ? null : Math.round(tpmap[e.id]), // @feature: time-based-progress-v1
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
      (key === "bootcamps" && !!fBootcamp) ||
      (key === "cohort" && !!fCohort) ||
      (key === "pct" && !!fProgress) ||
      (key === "deadline" && !!fDeadline)
    );
  }

  function applySort(key, dir) {
    setSortKey(key);
    setSortDir(dir);
  }

  // Enrollment-level rows after filters. Everything downstream — the grouped
  // table, the stat strip, and the CSV — derives from this, so a filter means
  // the same thing everywhere.
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

  // One entry per person, aggregated from their (filtered) enrollments.
  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      if (!map.has(r.userId)) {
        map.set(r.userId, { userId: r.userId, name: r.name, email: r.email, rows: [] });
      }
      map.get(r.userId).rows.push(r);
    });
    return [...map.values()].map((g) => {
      const rows = g.rows;
      const cohorts = [...new Set(rows.map((r) => r.cohort))];
      const deadlines = [...new Set(rows.map((r) => r.deadline).filter(Boolean))].sort();
      return {
        userId: g.userId,
        name: g.name,
        email: g.email,
        count: rows.length,
        bootcampList: rows
          .map((r) => r.bootcamp)
          .sort((a, b) => a.localeCompare(b))
          .join(", "),
        // Cohort only shown when unambiguous — a person spanning two cohorts
        // gets a dash rather than an arbitrary pick.
        cohort: cohorts.length === 1 ? cohorts[0] : "—",
        // Simple (unweighted) mean of their per-bootcamp completion.
        pct: Math.round(rows.reduce((s, r) => s + r.pct, 0) / rows.length),
        // Earliest deadline drives both display and sort; "+n" flags that more
        // exist, so it never reads as a single shared date.
        deadline: deadlines[0] || null,
        extraDeadlines: Math.max(0, deadlines.length - 1),
      };
    });
  }, [filtered]);

  const sortedGroups = useMemo(() => {
    const rows = [...groups];
    const dir = sortDir === "asc" ? 1 : -1;
    const nameCmp = (a, b) => a.name.localeCompare(b.name);
    rows.sort((a, b) => {
      if (sortKey === "pct") return (a.pct - b.pct) * dir || nameCmp(a, b);
      if (sortKey === "bootcamps") return (a.count - b.count) * dir || nameCmp(a, b);
      if (sortKey === "cohort") return String(a.cohort).localeCompare(String(b.cohort)) * dir || nameCmp(a, b);
      if (sortKey === "deadline") {
        const av = a.deadline || "";
        const bv = b.deadline || "";
        if (!av && !bv) return nameCmp(a, b);
        if (!av) return 1;
        if (!bv) return -1;
        return av < bv ? -dir : av > bv ? dir : nameCmp(a, b);
      }
      return nameCmp(a, b) * dir;
    });
    return rows;
  }, [groups, sortKey, sortDir]);

  const totalPeople = useMemo(() => new Set((data || []).map((r) => r.userId)).size, [data]);

  // Stat strip stays enrollment-level: "not started" / "finished" count
  // assignments, not people, since one person can be done with one bootcamp and
  // untouched on another.
  const stats = useMemo(() => {
    const rows = filtered;
    const n = rows.length;
    const people = new Set(rows.map((r) => r.userId)).size;
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

  // Deliberately exports the ungrouped, enrollment-level rows — one line per
  // person × bootcamp. The grouping above is a display convenience; the export
  // is for real work downstream, so it keeps every row.
  function exportCsv() {
    const rows = [...filtered].sort(
      (a, b) => a.name.localeCompare(b.name) || a.bootcamp.localeCompare(b.bootcamp)
    );
    const head = ["Name", "Email", "Bootcamp", "Cohort", "Progress %", "Time %", "Deadline"];
    const lines = [head.join(",")];
    rows.forEach((r) => {
      const cells = [r.name, r.email, r.bootcamp, r.cohort, r.pct, r.timePct ?? "", r.deadline || ""];
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
    if (key === "bootcamps") return ["Fewest first", "Most first"];
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
    if (key === "bootcamps") {
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
    const showFilter = col.filterable !== false;
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
        {showFilter ? (
          <div className="menu-sec">
            <div className="menu-lbl">Filter</div>
            {renderFilter(col.k)}
          </div>
        ) : null}
      </div>
    );
  }

  if (data === null) return <div className="stub">Loading dashboard…</div>;

  return (
    <>
      <div className="eyebrow">Dashboard</div>
      <h1 className="h1">Progress</h1>
      <div className="sub">Who&rsquo;s been assigned what and how far they&rsquo;ve gotten.</div>
      <div className="note" style={{ marginBottom: 16, maxWidth: 720 }}>
        One row per person — progress is the average across their bootcamps. Click a name for the
        per-bootcamp breakdown. <strong>Export CSV</strong> gives one row per bootcamp, not per person.
      </div>

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
          Showing {sortedGroups.length} of {totalPeople} people · {filtered.length} of {(data || []).length} assignments
          {anyFilter ? (
            <>
              {" · "}
              <button className="btn link sm" type="button" onClick={clearFilters}>Clear filters</button>
            </>
          ) : null}
        </span>
        <button className="btn ghost" onClick={exportCsv} disabled={!filtered.length}>Export CSV</button>
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
              {sortedGroups.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="dt-empty">No rows match your filters.</td>
                </tr>
              ) : (
                sortedGroups.map((g) => (
                  <tr key={g.userId}>
                    <td>
                      <Link
                        href={`/admin/people/${g.userId}`}
                        title="View per-bootcamp progress"
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        <span className="dt-name" style={{ display: "block" }}>{g.name}</span>
                      </Link>
                      <div className="dt-mail">{g.email}</div>
                    </td>
                    <td>
                      {g.count === 1 ? (
                        g.bootcampList
                      ) : (
                        <>
                          <div>{g.count} bootcamps</div>
                          <div className="dt-mail">{g.bootcampList}</div>
                        </>
                      )}
                    </td>
                    <td>{g.cohort}</td>
                    <td>
                      <div className="prog">
                        <span className="minibar">
                          <span className="minibar-fill" style={{ width: `${g.pct}%`, background: progressColor(g.pct) }} />
                        </span>
                        <span className="prog-pct">{g.pct}%</span>
                      </div>
                    </td>
                    <td className="dt-deadline">
                      {fmtDeadline(g.deadline)}
                      {g.extraDeadlines > 0 && <span className="note"> +{g.extraDeadlines}</span>}
                    </td>
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
