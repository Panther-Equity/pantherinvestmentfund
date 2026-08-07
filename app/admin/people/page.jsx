"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

const PEOPLE_COLUMNS = [
  { k: "name", label: "Name" },
  { k: "status", label: "Status" },
  { k: "role", label: "Role" },
];

const ROLE_RANK = { owner: 0, admin: 1, student: 2 };

export default function PeoplePage() {
  const supabase = createClient();

  const [me, setMe] = useState(null);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [copied, setCopied] = useState(false);

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [roleBusyId, setRoleBusyId] = useState(null);
  const [removeBusyId, setRemoveBusyId] = useState(null);

  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferConfirmText, setTransferConfirmText] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const [sortKey, setSortKey] = useState("role");
  const [sortDir, setSortDir] = useState("asc");
  const [openCol, setOpenCol] = useState(null);
  const [fName, setFName] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fRole, setFRole] = useState("");

  async function loadPeople() {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, status")
      .order("role")
      .order("full_name", { nullsFirst: false });
    setPeople(data || []);
  }

  async function loadMe() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from("profiles").select("id, role").eq("id", user.id).single();
      setMe(data);
    }
  }

  useEffect(() => {
    (async () => {
      await Promise.all([loadMe(), loadPeople()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isOwner = me?.role === "owner";

  const transferTargets = useMemo(
    () => people.filter((p) => p.role === "admin" && p.status === "active"),
    [people]
  );

  async function createInvite(e) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setInviteLink("");
    setCopied(false);
    setInviteBusy(true);
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, full_name: inviteName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the invite.");
      setInviteLink(data.inviteLink);
      setInvitedEmail(data.email);
      setInviteEmail("");
      setInviteName("");
      await loadPeople();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the field is selectable as a fallback.
    }
  }

  function clearInvite() {
    setInviteLink("");
    setInvitedEmail("");
    setCopied(false);
  }

  async function changeRole(person, newRole) {
    if (newRole === person.role) return;
    setErr("");
    setMsg("");
    setRoleBusyId(person.id);
    const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", person.id);
    if (error) {
      setErr(error.message);
    } else {
      setPeople((prev) => prev.map((p) => (p.id === person.id ? { ...p, role: newRole } : p)));
      setMsg(`${person.full_name || person.email} is now ${newRole}.`);
    }
    setRoleBusyId(null);
  }

  async function removePerson(person) {
    const label = person.full_name || person.email;
    if (
      !window.confirm(
        `Remove ${label}?\n\nThis permanently deletes their account and all their progress and scores. This can't be undone.`
      )
    ) {
      return;
    }
    setErr("");
    setMsg("");
    setRemoveBusyId(person.id);
    try {
      const res = await fetch("/api/remove-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not remove the person.");
      setPeople((prev) => prev.filter((p) => p.id !== person.id));
      setMsg(`Removed ${data.name || label}.`);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setRemoveBusyId(null);
    }
  }

  async function transferOwnership() {
    const target = transferTargets.find((p) => p.id === transferTargetId);
    if (!target) return;
    setErr("");
    setMsg("");
    setTransferBusy(true);
    try {
      const res = await fetch("/api/transfer-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerId: target.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not transfer ownership.");
      await Promise.all([loadMe(), loadPeople()]);
      setTransferOpen(false);
      setTransferTargetId("");
      setTransferConfirmText("");
      setMsg(`Ownership transferred to ${data.email || target.email}. You are now an admin.`);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setTransferBusy(false);
    }
  }

  const anyFilter = !!(fName || fStatus || fRole);

  function clearFilters() {
    setFName("");
    setFStatus("");
    setFRole("");
  }

  function colFiltered(key) {
    return (
      (key === "name" && !!fName) ||
      (key === "status" && !!fStatus) ||
      (key === "role" && !!fRole)
    );
  }

  function applySort(key, dir) {
    setSortKey(key);
    setSortDir(dir);
  }

  function nameOf(p) {
    return (p.full_name || p.email || "").toString();
  }

  const filtered = useMemo(() => {
    const q = fName.trim().toLowerCase();
    return people.filter((p) => {
      if (q && !`${p.full_name || ""} ${p.email || ""}`.toLowerCase().includes(q)) return false;
      if (fStatus && p.status !== fStatus) return false;
      if (fRole && p.role !== fRole) return false;
      return true;
    });
  }, [people, fName, fStatus, fRole]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    const nameCmp = (a, b) => nameOf(a).localeCompare(nameOf(b));
    rows.sort((a, b) => {
      if (sortKey === "name") return nameCmp(a, b) * dir;
      if (sortKey === "status")
        return String(a.status).localeCompare(String(b.status)) * dir || nameCmp(a, b);
      if (sortKey === "role")
        return ((ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9)) * dir || nameCmp(a, b);
      return 0;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  function sortLabels(key) {
    if (key === "role") return ["Owner first", "Student first"];
    if (key === "status") return ["Active first", "Invited first"];
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
    if (key === "status") {
      return (
        <OptionList
          current={fStatus}
          setter={setFStatus}
          options={[
            { v: "", l: "All" },
            { v: "active", l: "Active" },
            { v: "invited", l: "Invited" },
          ]}
        />
      );
    }
    return (
      <OptionList
        current={fRole}
        setter={setFRole}
        options={[
          { v: "", l: "All" },
          { v: "owner", l: "owner" },
          { v: "admin", l: "admin" },
          { v: "student", l: "student" },
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

  return (
    <>
      <div className="eyebrow">People</div>
      <h1 className="h1">Roster</h1>
      <div className="sub">Invite analysts by creating a private invite link, and manage who&rsquo;s an admin.</div>
      <div className="note" style={{ marginBottom: 16, maxWidth: 720 }}>
        Click a name to view their per-bootcamp progress and unassign them from individual bootcamps.{" "}
        <strong>Remove</strong> (right) deletes the whole account and every enrollment — there&rsquo;s no undo.
      </div>

      {err && <div className="notice error" style={{ maxWidth: 720 }}>{err}</div>}
      {msg && <div className="notice ok" style={{ maxWidth: 720 }}>{msg}</div>}

      <div className="card" style={{ maxWidth: 720, marginBottom: 16 }}>
        <div className="picklabel" style={{ marginBottom: 12 }}>
          <span>Invite someone</span>
        </div>
        <form onSubmit={createInvite}>
          <div className="assign-opts">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Email</label>
              <input
                className="input"
                type="email"
                placeholder="analyst@pitt.edu"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Full name (optional)</label>
              <input
                className="input"
                placeholder="Jane Analyst"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
              />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn pri" type="submit" disabled={inviteBusy}>
              {inviteBusy ? "Creating…" : "Create invite link"}
            </button>
          </div>
        </form>
      </div>

      {inviteLink && (
        <div className="card invite-ready" style={{ maxWidth: 720, marginBottom: 22 }}>
          <div className="picklabel" style={{ marginBottom: 10 }}>
            <span>Invite link ready — for {invitedEmail}</span>
            <button className="btn link sm" type="button" onClick={clearInvite}>Invite someone else</button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <input
              className="input mono-input"
              readOnly
              value={inviteLink}
              onFocus={(e) => e.target.select()}
            />
            <button className="btn pri" type="button" onClick={copyLink} style={{ whiteSpace: "nowrap" }}>
              {copied ? "Copied ✓" : "Copy link"}
            </button>
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            Send this privately to {invitedEmail} (email, Slack, etc.). It lets them set a password and join, and
            expires in about 24 hours. To test it yourself, open it in a private / incognito window.
          </div>
        </div>
      )}

      {loading ? (
        <div className="stub">Loading roster…</div>
      ) : people.length === 0 ? (
        <div className="stub">No one here yet. Create an invite above to get started.</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 10px" }}>
            <span className="note">
              Showing {sorted.length} of {people.length}
              {anyFilter ? (
                <>
                  {" · "}
                  <button className="btn link sm" type="button" onClick={clearFilters}>Clear filters</button>
                </>
              ) : null}
            </span>
          </div>
          <div className="dtable-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  {PEOPLE_COLUMNS.map((col) => (
                    <th key={col.k} className="th-h" style={col.k === "role" ? { width: 190 } : undefined}>
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
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="dt-empty">No one matches your filters.</td>
                  </tr>
                ) : (
                  sorted.map((p) => {
                    const isSelf = me && p.id === me.id;
                    const isOwnerRow = p.role === "owner";
                    const canEditRole = isOwner && !isSelf && !isOwnerRow;
                    const canRemove = !isSelf && !isOwnerRow;
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link
                            href={`/admin/people/${p.id}`}
                            title="View progress"
                            style={{ color: "inherit", textDecoration: "none" }}
                          >
                            <span className="dt-name" style={{ display: "block" }}>{p.full_name || "—"}</span>
                          </Link>
                          <div className="dt-mail">{p.email}</div>
                        </td>
                        <td>
                          <span className={`pill ${p.status === "invited" ? "pill-warn" : "pill-ok"}`}>
                            {p.status === "invited" ? "Invited" : "Active"}
                          </span>
                        </td>
                        <td>
                          {canEditRole ? (
                            <select
                              className="input role-select"
                              value={p.role}
                              disabled={roleBusyId === p.id}
                              onChange={(e) => changeRole(p, e.target.value)}
                            >
                              <option value="student">student</option>
                              <option value="admin">admin</option>
                            </select>
                          ) : (
                            <span className={`rolechip ${isOwnerRow ? "owner" : ""}`}>{p.role}</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {canRemove && (
                            <button
                              className="btn danger sm"
                              type="button"
                              disabled={removeBusyId === p.id}
                              onClick={() => removePerson(p)}
                            >
                              {removeBusyId === p.id ? "Removing…" : "Remove"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isOwner && !loading && (() => {
        const target = transferTargets.find((p) => p.id === transferTargetId) || null;
        const requiredPhrase = target ? `TRANSFER OWNERSHIP TO ${target.email}` : "";
        const canConfirm = !!target && transferConfirmText.trim() === requiredPhrase && !transferBusy;
        return (
          <div className="card" style={{ maxWidth: 720, marginTop: 28, borderColor: "var(--danger, #dc2626)" }}>
            <div className="picklabel" style={{ marginBottom: 8 }}>
              <span style={{ color: "var(--danger, #dc2626)" }}>Danger zone — transfer ownership</span>
            </div>
            <div className="note" style={{ marginBottom: 14 }}>
              Hand the single owner role to another admin. You become an admin and lose owner-only powers
              (changing roles, removing admins, this transfer). Meant to be done once, at handoff — you
              can&rsquo;t undo it afterward.
            </div>
            {transferTargets.length === 0 ? (
              <div className="note">
                No eligible admins yet. The new owner must already be an <strong>active admin</strong> first.
              </div>
            ) : !transferOpen ? (
              <button className="btn danger" type="button" onClick={() => setTransferOpen(true)}>
                Transfer ownership…
              </button>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>New owner (active admins only)</label>
                  <select
                    className="input"
                    value={transferTargetId}
                    onChange={(e) => { setTransferTargetId(e.target.value); setTransferConfirmText(""); }}
                  >
                    <option value="">Select an admin…</option>
                    {transferTargets.map((p) => (
                      <option key={p.id} value={p.id}>{(p.full_name || p.email)} — {p.email}</option>
                    ))}
                  </select>
                </div>
                {target && (
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Type <code>{requiredPhrase}</code> to confirm</label>
                    <input
                      className="input mono-input"
                      value={transferConfirmText}
                      onChange={(e) => setTransferConfirmText(e.target.value)}
                      placeholder={requiredPhrase}
                      autoComplete="off"
                    />
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn danger" type="button" disabled={!canConfirm} onClick={transferOwnership}>
                    {transferBusy ? "Transferring…" : "Confirm transfer"}
                  </button>
                  <button
                    className="btn link"
                    type="button"
                    disabled={transferBusy}
                    onClick={() => { setTransferOpen(false); setTransferTargetId(""); setTransferConfirmText(""); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {!isOwner && !loading && (
        <div className="note" style={{ marginTop: 12 }}>
          Only the owner account can change roles.
        </div>
      )}

      {openCol && <div className="menu-overlay" onClick={() => setOpenCol(null)} />}
    </>
  );
}