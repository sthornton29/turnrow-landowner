// Pure helpers over the generated help content (lib/helpContent.generated.ts,
// built from docs/help by `npm run help:build`): route -> topic resolution
// (longest prefix, so /import/county beats /import), related topics on the
// same route, the drawer and Help Center search, and nav-order grouping.
// Kept pure for the vitest coverage suite.

import type { HelpTopic } from "@/lib/helpContent.generated";

// Nav order for the Help Center groups.
export const HELP_GROUP_ORDER = [
  "Getting started",
  "Map",
  "Properties",
  "Timber",
  "Assets",
  "Leases",
  "Property Taxes",
  "Income",
  "Documents",
  "Gov Payments",
  "Farm Data",
  "Import",
  "Settings",
];

function covers(topicRoute: string, pathname: string): boolean {
  return pathname === topicRoute || pathname.startsWith(topicRoute + "/");
}

/** The primary help topic for a pathname: exact route or the longest
 *  covering prefix; among topics on that route, the lowest order. */
export function topicForRoute(
  topics: ReadonlyArray<HelpTopic>,
  pathname: string | null | undefined
): HelpTopic | null {
  if (!pathname) return null;
  const clean = pathname.split("?")[0];
  let best: HelpTopic | null = null;
  for (const t of topics) {
    if (!covers(t.route, clean)) continue;
    if (
      best == null ||
      t.route.length > best.route.length ||
      (t.route.length === best.route.length && t.order < best.order)
    ) {
      best = t;
    }
  }
  return best;
}

/** Every topic that shares the primary topic's route, in order (the
 *  drawer's "Also on this page" list). */
export function topicsForRoute(
  topics: ReadonlyArray<HelpTopic>,
  pathname: string | null | undefined
): HelpTopic[] {
  const primary = topicForRoute(topics, pathname);
  if (!primary) return [];
  return topics
    .filter((t) => t.route === primary.route)
    .sort((a, b) => a.order - b.order);
}

/** Case-insensitive search across title, keywords, and body. Every term
 *  must match; ranking prefers title hits, then keyword hits, then body.
 *  An empty query returns everything in nav order. */
export function searchTopics(topics: ReadonlyArray<HelpTopic>, query: string): HelpTopic[] {
  const q = query.trim().toLowerCase();
  const ordered = [...topics].sort(
    (a, b) =>
      groupIndex(a.group) - groupIndex(b.group) ||
      a.route.localeCompare(b.route) ||
      a.order - b.order
  );
  if (!q) return ordered;
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ t: HelpTopic; score: number }> = [];
  for (const t of ordered) {
    const title = t.title.toLowerCase();
    const keywords = t.keywords.toLowerCase();
    const body = t.body.toLowerCase();
    let score = 0;
    let all = true;
    for (const term of terms) {
      if (title.includes(term)) score += 10;
      else if (keywords.includes(term)) score += 5;
      else if (body.includes(term)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ t, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.t);
}

function groupIndex(group: string): number {
  const i = HELP_GROUP_ORDER.indexOf(group);
  return i === -1 ? HELP_GROUP_ORDER.length : i;
}

/** Group topics the way the nav is organized, for the /help page. */
export function groupTopics(
  topics: ReadonlyArray<HelpTopic>
): Array<{ title: string; topics: HelpTopic[] }> {
  const byGroup = new Map<string, HelpTopic[]>();
  for (const t of topics) {
    byGroup.set(t.group, [...(byGroup.get(t.group) ?? []), t]);
  }
  return [...byGroup.entries()]
    .sort((a, b) => groupIndex(a[0]) - groupIndex(b[0]) || a[0].localeCompare(b[0]))
    .map(([title, list]) => ({
      title,
      topics: list.sort((a, b) => a.route.localeCompare(b.route) || a.order - b.order),
    }));
}
