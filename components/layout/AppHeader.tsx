"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/map", label: "Map" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/properties", label: "Properties" },
  { href: "/timber", label: "Timber" },
  { href: "/assets", label: "Assets" },
  { href: "/leases", label: "Leases" },
  { href: "/taxes", label: "Property Taxes" },
  { href: "/income", label: "Income" },
  { href: "/farm-activity", label: "Farm Data" },
  { href: "/import", label: "Import" },
];

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

export default function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-full max-w-7xl items-center gap-4 px-4">
        {/* Brand: the horizontal logo stands alone (T mark on mobile).
            Tapping it goes home, which is the map now. */}
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

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              pathname.startsWith(item.href + "/") ||
              // Entities is a tab of the Properties section
              (item.href === "/properties" && pathname.startsWith("/entities"));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition " +
                  (active
                    ? "bg-kelly-50 text-pine-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900")
                }
              >
                {item.label}
              </Link>
            );
          })}
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

        {/* Mobile: settings gear up top; main nav is the bottom tab bar */}
        <Link
          href="/settings"
          aria-label="Settings"
          className="ml-auto rounded-lg p-2 text-gray-500 md:hidden"
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
