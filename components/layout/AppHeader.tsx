"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/(auth)/actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/map", label: "Map" },
  { href: "/properties", label: "Properties" },
  { href: "/timber", label: "Timber" },
  { href: "/assets", label: "Assets" },
  { href: "/leases", label: "Leases" },
  { href: "/taxes", label: "Taxes" },
  { href: "/income", label: "Income" },
  { href: "/farm-activity", label: "Farm Data" },
  { href: "/import", label: "Import" },
  { href: "/settings/members", label: "Members" },
];

export default function AppHeader({
  isPlatformAdmin = false,
}: {
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const nav = isPlatformAdmin
    ? [...NAV, { href: "/admin/gis", label: "Admin" }]
    : NAV;

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-full max-w-7xl items-center gap-4 px-4">
        {/* Brand lockup: logo + "Landowner" wordmark. Reads as branding,
            not a nav item: letterspaced small caps, no hover affordance.
            Tapping it still goes home, as logos conventionally do. */}
        <Link href="/dashboard" className="flex shrink-0 items-end gap-1.5">
          {/* Full wordmark on desktop, T mark on mobile */}
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
          <span
            aria-hidden
            className="pb-0.5 text-[11px] font-light uppercase leading-none tracking-[0.22em] text-pine-900"
          >
            Landowner
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {nav.map((item) => {
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
          <form action={signOut} className="ml-2">
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
            >
              Sign out
            </button>
          </form>
        </nav>

        {/* Mobile: sign out lives up top; main nav is the bottom tab bar */}
        <form action={signOut} className="ml-auto md:hidden">
          <button
            type="submit"
            className="rounded-lg px-2 py-1.5 text-sm font-medium text-gray-500"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
