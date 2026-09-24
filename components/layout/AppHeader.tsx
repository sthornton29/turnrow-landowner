"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import HelpDrawer from "@/components/help/HelpDrawer";
import { DESKTOP_NAV, isActive, isGroup, type NavGroup } from "./nav";

const GEAR_PATH = (
  <>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </>
);

const PILL = "rounded-lg px-3 py-1.5 text-sm font-medium transition ";
const PILL_ACTIVE = "bg-kelly-50 text-pine-900";
const PILL_IDLE = "text-gray-600 hover:bg-gray-50 hover:text-gray-900";

// A grouped section of the header: a pill that opens a small menu on
// click (not hover, so it works the same with a trackpad, a touch
// screen, and a keyboard). Closes on outside click, Escape, or when the
// route changes.
function GroupMenu({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeChild = group.items.find((item) => isActive(pathname, item.href));

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={PILL + "flex items-center gap-1 " + (activeChild ? PILL_ACTIVE : PILL_IDLE)}
      >
        {/* The pill names the page you are on inside the group, so the
            header still reads "Property Taxes" when that is where you are. */}
        {activeChild ? activeChild.label : group.label}
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 opacity-70" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                className={
                  "block px-3 py-2 transition " +
                  (active ? "bg-kelly-50" : "hover:bg-gray-50")
                }
              >
                <span className={"block text-sm font-medium " + (active ? "text-pine-900" : "text-gray-900")}>
                  {item.label}
                </span>
                <span className="block text-xs text-gray-500">{item.hint}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-gray-200 bg-white">
      <div className="flex h-full w-full items-center gap-4 px-4 md:px-6">
        {/* Brand: the horizontal logo stands alone (T mark on mobile).
            Tapping it goes home, which is the map. */}
        <Link href="/map" className="flex shrink-0 items-center">
          <Image
            src="/brand/turnrow_horizontal_green.svg"
            alt="Turnrow"
            width={150}
            height={32}
            priority
            className="hidden h-8 w-auto md:block"
          />
          <Image
            src="/brand/turnrow_t_green.svg"
            alt="Turnrow"
            width={32}
            height={32}
            priority
            className="h-8 w-auto md:hidden"
          />
        </Link>

        <nav className="ml-auto hidden min-w-0 items-center justify-end gap-1 md:flex">
          {DESKTOP_NAV.map((entry) =>
            isGroup(entry) ? (
              <GroupMenu key={entry.label} group={entry} pathname={pathname} />
            ) : (
              <Link
                key={entry.href}
                href={entry.href}
                className={PILL + (isActive(pathname, entry.href) ? PILL_ACTIVE : PILL_IDLE)}
              >
                {entry.label}
              </Link>
            )
          )}
          <HelpDrawer />
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className={
              "ml-1 rounded-lg p-2 transition " +
              (pathname.startsWith("/settings")
                ? "bg-kelly-50 text-pine-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900")
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="h-5 w-5"
            >
              {GEAR_PATH}
            </svg>
          </Link>
        </nav>

        {/* Mobile: help and settings up top; main nav is the bottom tab bar */}
        <div className="ml-auto flex items-center md:hidden">
          <HelpDrawer />
        </div>
        <Link
          href="/settings"
          aria-label="Settings"
          className="rounded-lg p-2 text-gray-500 md:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="h-6 w-6"
          >
            {GEAR_PATH}
          </svg>
        </Link>
      </div>
    </header>
  );
}
