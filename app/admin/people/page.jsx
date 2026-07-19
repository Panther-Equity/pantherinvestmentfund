"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

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

  return (
    <>
      <div className="eyebrow">People</div>
      <h1 className="h1">Roster</h1>
      <div className="sub">Invite analysts by creating a private invite link, and manage who&rsquo;s an admin.</div>

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
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th style={{ width: 190 }}>Role</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const isSelf = me && p.id === me.id;
                const isOwnerRow = p.role === "owner";
                const canEditRole = isOwner && !isSelf && !isOwnerRow;
                const canRemove = !isSelf && !isOwnerRow;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="dt-name">{p.full_name || "—"}</div>
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
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isOwner && !loading && (
        <div className="note" style={{ marginTop: 12 }}>
          Only the owner account can change roles.
        </div>
      )}
    </>
  );
}
