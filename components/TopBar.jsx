const ROLE_LABEL = { owner: "Owner", admin: "Admin", student: "Student" };

export default function TopBar({ name, email, role }) {
  const label = ROLE_LABEL[role] || "Student";
  return (
    <div className="pe-top">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="pe-logo" src="/logo.png" alt="Panther Equity" />
      <div className="pe-right">
        <span className={`rolechip ${role === "owner" ? "owner" : ""}`}>{label}</span>
        <div className="pe-user">
          {name}
          <span>{email}</span>
        </div>
        <form action="/auth/signout" method="post">
          <button className="signout" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
