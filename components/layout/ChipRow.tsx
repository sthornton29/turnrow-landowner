"use client";

import { useEffect, useRef } from "react";

// A row of chips or buttons that is ONE line on a phone, swiped
// sideways, instead of wrapping into several rows that push the page
// down. It runs edge to edge (it undoes the page's p-4 on phones). On
// wider screens it wraps as before. When it loads, or the choice
// changes, the chosen item (data-active="true") is scrolled into view so
// the current choice is never hidden off the edge.
export default function ChipRow({
  children,
  activeKey,
  className = "",
}: {
  children: React.ReactNode;
  // Changes when the choice changes; the row re-centers on it then.
  activeKey?: string;
  // Extra classes, typically the md: layout (e.g. "md:justify-end").
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = ref.current;
    if (!row || row.scrollWidth <= row.clientWidth) return;
    const active = row.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    row.scrollLeft = Math.max(
      0,
      active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2
    );
  }, [activeKey]);

  return (
    <div
      ref={ref}
      className={
        "no-scrollbar relative -mx-4 flex gap-1.5 overflow-x-auto px-4 *:shrink-0 *:whitespace-nowrap " +
        "md:mx-0 md:flex-wrap md:overflow-visible md:px-0 " +
        className
      }
    >
      {children}
    </div>
  );
}
