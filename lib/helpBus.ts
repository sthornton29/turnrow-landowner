// Tiny client-side event bus so any page can deep-open the help drawer to
// a topic ("Learn more" links) without prop drilling through layouts. The
// drawer (components/help/HelpDrawer.tsx) listens.

export const HELP_OPEN_EVENT = "turnrow:open-help";

export interface HelpOpenDetail {
  route?: string;
  tab?: "topic" | "browse" | "chat" | "support";
}

export function openHelp(detail: HelpOpenDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<HelpOpenDetail>(HELP_OPEN_EVENT, { detail }));
}
