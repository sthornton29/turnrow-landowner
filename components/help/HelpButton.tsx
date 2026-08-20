"use client";

// A "Learn more" style button any page can drop in to open the help drawer
// on a given topic route (defaults to the current page).

import { openHelp, type HelpOpenDetail } from "@/lib/helpBus";

export default function HelpButton({
  route,
  tab,
  children = "Learn more",
  className = "text-xs font-medium text-kelly-700 hover:underline",
}: HelpOpenDetail & { children?: React.ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => openHelp({ route, tab })} className={className}>
      {children}
    </button>
  );
}
