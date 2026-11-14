"use client";

// The Help drawer: opens from the "?" in the header (or any "Learn more"
// link via lib/helpBus). Auto-lands on the topic for the current page
// (longest route-prefix match), with search across every topic, the
// how-to chat (knows the app, not your data), and Contact support.
// Content ships with the app (lib/helpContent.generated.ts, built by
// `npm run help:build`). Right drawer on desktop, bottom sheet on phones.
// Kept visibly separate from Ask (the data assistant).
//
// The sheet is rendered through a portal to document.body. The "?" button
// lives inside the sticky header, and a sheet rendered there is trapped in
// the header's stacking layer: the phone's bottom tab bar painted over the
// sheet's bottom strip and hid the chat box, Send, and "Send to support".

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HELP_TOPICS, type HelpTopic } from "@/lib/helpContent.generated";
import { searchTopics, topicForRoute, topicsForRoute } from "@/lib/help";
import { renderHelpMarkdown } from "@/lib/helpMarkdown";
import { HELP_OPEN_EVENT, type HelpOpenDetail } from "@/lib/helpBus";
import { formatDate } from "@/lib/format";
import SupportChat from "./SupportChat";
import ContactSupportForm from "./ContactSupportForm";

type Tab = "topic" | "browse" | "chat" | "support";

const TABS: Array<[Tab, string]> = [
  ["topic", "This page"],
  ["browse", "All topics"],
  ["chat", "How-to chat"],
  ["support", "Contact support"],
];

export default function HelpDrawer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("topic");
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const [query, setQuery] = useState("");
  const [transcript, setTranscript] = useState<string | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // document.body exists only in the browser; the portal waits for mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Deep-open requests from anywhere in the app.
  useEffect(() => {
    const onOpen = (e: Event) => {
      // The header renders this component twice (desktop bar and phone
      // bar) and hides one with CSS. Only the one whose "?" is on screen
      // answers, or the portal would stack two sheets.
      if (!buttonRef.current || buttonRef.current.offsetParent === null) return;
      const detail = (e as CustomEvent<HelpOpenDetail>).detail ?? {};
      setTopic(topicForRoute(HELP_TOPICS, detail.route ?? pathname));
      setTab(detail.tab ?? "topic");
      setOpen(true);
    };
    window.addEventListener(HELP_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(HELP_OPEN_EVENT, onOpen);
  }, [pathname]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openFromButton() {
    setTopic(topicForRoute(HELP_TOPICS, pathname));
    setTab("topic");
    setOpen(true);
  }

  const results = useMemo(() => searchTopics(HELP_TOPICS, query), [query]);
  const current = topic ?? topicForRoute(HELP_TOPICS, pathname);
  const related = useMemo(
    () => (current ? topicsForRoute(HELP_TOPICS, current.route).filter((t) => t.slug !== current.slug) : []),
    [current]
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={openFromButton}
        title="Help and support"
        aria-label="Help and support"
        className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-300 text-sm font-semibold text-gray-600 hover:border-kelly-500 hover:text-pine-900"
      >
        ?
      </button>
      {open && mounted ? createPortal(
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          {/* The bottom padding keeps the last row of controls above the
              phone's home indicator, as the tab bar and the More sheet do. */}
          <div className="absolute inset-x-0 bottom-0 flex max-h-[88%] flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] text-gray-800 shadow-2xl md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:h-full md:max-h-none md:w-full md:max-w-md md:rounded-none md:pb-0">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
              <h2 className="flex-1 text-lg font-semibold text-pine-900">Help</h2>
              <Link
                href="/help"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-kelly-700 hover:underline"
              >
                Help Center
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close help"
                className="ml-2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-3 pt-2 text-sm">
              {TABS.map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    "whitespace-nowrap rounded-t-lg px-2.5 py-1.5 font-medium " +
                    (tab === t ? "bg-kelly-50 text-pine-900" : "text-gray-500 hover:text-gray-800")
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {tab === "topic" ? (
                current ? (
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-lg font-semibold text-pine-900">{current.title}</h3>
                      <span className="whitespace-nowrap text-[11px] text-gray-400">
                        updated {formatDate(current.updated)}
                      </span>
                    </div>
                    <div className="mt-1">{renderHelpMarkdown(current.body)}</div>
                    {related.length > 0 ? (
                      <div className="mt-4 rounded-lg bg-gray-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Also on this page
                        </p>
                        <ul className="mt-1 space-y-1">
                          {related.map((t) => (
                            <li key={t.slug}>
                              <button
                                type="button"
                                onClick={() => setTopic(t)}
                                className="text-sm font-medium text-kelly-700 hover:underline"
                              >
                                {t.title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="pt-6 text-center text-sm text-gray-500">
                    No help topic for this page yet. Browse all topics or ask the how-to chat.
                  </p>
                )
              ) : null}

              {tab === "browse" ? (
                <div className="space-y-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search help"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
                  />
                  <ul className="divide-y divide-gray-100">
                    {results.map((t) => (
                      <li key={t.slug}>
                        <button
                          type="button"
                          onClick={() => {
                            setTopic(t);
                            setTab("topic");
                          }}
                          className="w-full rounded px-1 py-2 text-left hover:bg-gray-50"
                        >
                          <span className="text-sm font-medium text-gray-900">{t.title}</span>
                          <span className="block text-[11px] text-gray-400">{t.group}</span>
                        </button>
                      </li>
                    ))}
                    {results.length === 0 ? (
                      <li className="py-4 text-center text-sm text-gray-400">No matches.</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {tab === "chat" ? (
                <SupportChat
                  pathname={pathname ?? "/"}
                  onEscalate={(t) => {
                    setTranscript(t);
                    setTab("support");
                  }}
                />
              ) : null}

              {tab === "support" ? (
                <ContactSupportForm pathname={pathname ?? "/"} transcript={transcript} />
              ) : null}
            </div>

            {tab === "topic" || tab === "browse" ? (
              <div className="flex gap-2 border-t border-gray-200 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setTab("chat")}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Ask the assistant
                </button>
                <button
                  type="button"
                  onClick={() => setTab("support")}
                  className="flex-1 rounded-lg bg-kelly-500 px-3 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
                >
                  Contact support
                </button>
              </div>
            ) : null}
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
