"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MOBILE_GROUPS, NAV_ITEMS, isActive, type NavItem } from "./nav";

// Four fixed tabs plus "More": the sheet lists EVERY section grouped
// the same way as the desktop header, so nothing on a phone is more
// than two taps away (before this, Timber, Assets, Maintenance, Taxes,
// Government Payments, Documents, Ask, Farm Data, and Import had no
// phone navigation at all).
const TABS: Array<NavItem & { icon: React.ReactNode }> = [
  {
    ...NAV_ITEMS.map,
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z"
      />
    ),
  },
  {
    ...NAV_ITEMS.home,
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"
      />
    ),
  },
  {
    ...NAV_ITEMS.properties,
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
      />
    ),
  },
  {
    ...NAV_ITEMS.leases,
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    ),
  },
];

const TAB_HREFS = new Set(TABS.map((t) => t.href));

export default function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the sheet when the route changes and on Escape.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // "More" lights up when the current page lives only in the sheet.
  const onTab = TABS.some((t) => isActive(pathname, t.href));
  const moreActive = !onTab && (pathname.startsWith("/settings") || MOBILE_GROUPS.some((g) => g.items.some((i) => isActive(pathname, i.href))));

  const tabClass = (active: boolean) =>
    "flex flex-col items-center justify-center gap-0.5 text-xs font-medium " +
    (active ? "text-kelly-600" : "text-gray-500");

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="All sections">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
              <span className="text-base font-semibold text-gray-900">All sections</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            <div className="space-y-4 px-2 py-3">
              {MOBILE_GROUPS.map((group) => {
                const items = group.items.filter((i) => !TAB_HREFS.has(i.href));
                if (items.length === 0) return null;
                return (
                  <section key={group.label}>
                    <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      {group.label}
                    </p>
                    <ul>
                      {items.map((item) => {
                        const active = isActive(pathname, item.href);
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              className={
                                "block rounded-lg px-2 py-2.5 " + (active ? "bg-kelly-50" : "active:bg-gray-50")
                              }
                            >
                              <span className={"block text-sm font-medium " + (active ? "text-pine-900" : "text-gray-900")}>
                                {item.label}
                              </span>
                              <span className="block text-xs text-gray-500">{item.hint}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              <section>
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Account
                </p>
                <Link
                  href="/settings"
                  className={"block rounded-lg px-2 py-2.5 " + (pathname.startsWith("/settings") ? "bg-kelly-50" : "active:bg-gray-50")}
                >
                  <span className="block text-sm font-medium text-gray-900">Settings</span>
                  <span className="block text-xs text-gray-500">Members, invitations, and farm connections.</span>
                </Link>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid h-16 grid-cols-5">
          {TABS.map((tab) => (
            <Link key={tab.href} href={tab.href} className={tabClass(isActive(pathname, tab.href))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-6 w-6">
                {tab.icon}
              </svg>
              {tab.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={tabClass(moreActive || open)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            More
          </button>
        </div>
      </nav>
    </>
  );
}
