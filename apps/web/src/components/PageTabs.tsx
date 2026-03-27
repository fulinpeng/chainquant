"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "跟单" },
  { href: "/stats", label: "统计" },
];

export default function PageTabs() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="flex items-center gap-2">
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname === tab.href || pathname.startsWith("/stats/");

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg border px-4 py-2 text-sm transition ${
              active
                ? "border-oo-primary bg-oo-primary/10 text-oo-primary"
                : "border-oo-border-strong text-oo-text-secondary hover:bg-oo-surface-hover"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
