"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/bootcamps", label: "Bootcamps" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/assign", label: "Assign" },
];

export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="tabs">
      {TABS.map((t) => {
        const active =
          t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`tab ${active ? "on" : ""}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
