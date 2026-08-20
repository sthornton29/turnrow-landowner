"use client";

// The Help Center: every topic, grouped the way the nav is organized, with
// search across titles, keywords, and content. Content ships with the app
// (lib/helpContent.generated.ts). ?topic=<slug> deep-links a topic.

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HELP_GENERATED, HELP_TOPICS, type HelpTopic } from "@/lib/helpContent.generated";
import { groupTopics, searchTopics } from "@/lib/help";
import { renderHelpMarkdown } from "@/lib/helpMarkdown";
import { openHelp } from "@/lib/helpBus";

function HelpCenter() {
  const params = useSearchParams();
  const initial = params.get("topic");
  const [query, setQuery] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(initial);
  const results = useMemo(() => searchTopics(HELP_TOPICS, query), [query]);
  const groups = useMemo(() => groupTopics(results), [results]);
  const open = openSlug ? (HELP_TOPICS.find((t) => t.slug === openSlug) ?? null) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Help Center</h1>
        <p className="mt-1 text-sm text-gray-500">
          How every part of the app works. For anything about your own numbers, use Ask in
          the menu; to reach a person, use Contact support from the{" "}
          <span className="font-semibold">?</span> button.
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpenSlug(null);
        }}
        placeholder="Search help: try easement, closure, invite, base acres"
        className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm shadow-sm focus:border-kelly-500 focus:outline-none"
      />

      {open ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <button
            type="button"
            onClick={() => setOpenSlug(null)}
            className="mb-2 text-sm font-medium text-kelly-700 hover:underline"
          >
            &larr; All topics
          </button>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold text-pine-900">{open.title}</h2>
            <span className="text-xs text-gray-400">updated {open.updated}</span>
          </div>
          <div className="mt-2">{renderHelpMarkdown(open.body)}</div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => openHelp({ route: open.route, tab: "chat" })}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Ask the how-to chat
            </button>
            <button
              type="button"
              onClick={() => openHelp({ route: open.route, tab: "support" })}
              className="rounded-lg bg-kelly-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-kelly-600"
            >
              Contact support
            </button>
          </div>
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {g.title}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {g.topics.map((t: HelpTopic) => (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => setOpenSlug(t.slug)}
                    className="rounded-xl border border-gray-200 bg-white p-4 text-left hover:bg-kelly-50"
                  >
                    <div className="font-semibold text-gray-900">{t.title}</div>
                    <div className="mt-0.5 text-xs text-gray-400">updated {t.updated}</div>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {results.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              Nothing matched. Try different words, or ask the how-to chat from the ? button.
            </p>
          ) : null}
        </>
      )}

      <p className="text-center text-[11px] text-gray-400">Help content generated {HELP_GENERATED}.</p>
    </div>
  );
}

export default function HelpCenterPage() {
  return (
    <Suspense fallback={null}>
      <HelpCenter />
    </Suspense>
  );
}
