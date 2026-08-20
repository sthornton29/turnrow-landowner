"use client";

// "Ask about your land": the data assistant thread. Session-only: the
// conversation array is resent each turn and nothing persists beyond the
// page. The server does the tool work; this component renders the stream.
//
// Stream protocol (newline-delimited JSON from /api/data-assistant):
//   {"t":"..."}   text delta
//   {"s":"..."}   transient status while a tool runs
//   {"d":{"tools":[...],"at":"ISO"}}  end of turn, for the footer
//   {"e":"..."}   error surfaced mid-stream

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { TOOL_PAGE_LINKS } from "@/lib/assistantTools";

export type AssistantMessage = { role: "user" | "assistant"; content: string };
type TurnMeta = { tools: string[]; at: string };

export const STARTER_QUESTIONS = [
  "How many acres do I own in Lawrence County?",
  "Which parcels have unpaid 2025 taxes?",
  "What did timber sales bring in last year?",
  "What easements cross the Smith place?",
];

// Markdown-light: **bold**, bullet lists, numbered lists, paragraphs.
function renderLight(text: string): ReactNode {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    out.push(
      list.ordered ? (
        <ol key={out.length} className="ml-4 list-decimal space-y-0.5">{list.items}</ol>
      ) : (
        <ul key={out.length} className="ml-4 list-disc space-y-0.5">{list.items}</ul>
      )
    );
    list = null;
  };
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  lines.forEach((line, i) => {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(<li key={i}>{inline((bullet ?? numbered)![1])}</li>);
      return;
    }
    flush();
    if (line.trim() === "") return;
    out.push(<p key={i}>{inline(line)}</p>);
  });
  flush();
  return <div className="space-y-1.5">{out}</div>;
}

export default function AssistantChat({
  autoFocus = false,
  initialQuestion = null,
}: {
  autoFocus?: boolean;
  initialQuestion?: string | null;
}) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [metaByIndex, setMetaByIndex] = useState<Record<number, TurnMeta>>({});
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setErr(null);
    const next: AssistantMessage[] = [...messages, { role: "user", content: text.trim() }];
    const replyIndex = next.length;
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/data-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "The assistant is unavailable right now.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let buffer = "";
      let streamError: string | null = null;
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        let ev: { t?: string; s?: string; d?: TurnMeta; e?: string };
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (typeof ev.t === "string") {
          acc += ev.t;
          setStatus(null);
          const current = acc;
          setMessages([...next, { role: "assistant", content: current }]);
        } else if (typeof ev.s === "string") {
          setStatus(ev.s);
        } else if (ev.d) {
          const meta = ev.d;
          setMetaByIndex((m) => ({ ...m, [replyIndex]: meta }));
        } else if (typeof ev.e === "string") {
          streamError = ev.e;
        }
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      }
      if (buffer.trim()) handleLine(buffer);
      if (streamError) throw new Error(streamError);
      if (!acc.trim()) throw new Error("The assistant did not answer. Try again.");
    } catch (error) {
      setMessages(next);
      setErr(error instanceof Error ? error.message : "The assistant is unavailable right now.");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  useEffect(() => {
    if (initialQuestion && !startedRef.current) {
      startedRef.current = true;
      void ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  function footer(meta: TurnMeta) {
    const links = meta.tools.map((t) => TOOL_PAGE_LINKS[t]).filter(Boolean);
    const seen = new Set<string>();
    const unique = links.filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true)));
    const at = new Date(meta.at);
    const stamp = isNaN(at.getTime()) ? "" : ` as of ${at.toLocaleString()}`;
    return (
      <p className="mt-1 text-[11px] text-gray-400">
        From your Turnrow records{stamp}
        {unique.length > 0 ? (
          <>
            {". Verify on "}
            {unique.map((l, i) => (
              <span key={l.href}>
                {i > 0 ? ", " : ""}
                <Link href={l.href} className="underline decoration-dotted">
                  {l.label}
                </Link>
              </span>
            ))}
          </>
        ) : null}
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="border-b border-gray-100 pb-2 text-xs text-gray-500">
        Answers come from <b>your own records</b>, the same numbers as your pages.
        Nothing here is visible to anyone outside your organization.
      </p>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
        {messages.length === 0 ? (
          <div className="space-y-2 pt-6">
            <p className="text-center text-sm text-gray-400">Try one of these:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void ask(q)}
                  className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:border-kelly-500 hover:text-pine-900"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start"}>
            <div
              className={
                "max-w-[88%] rounded-2xl px-3 py-2 text-sm " +
                (m.role === "user"
                  ? "rounded-br-sm bg-kelly-500 text-white"
                  : "rounded-bl-sm bg-gray-100 text-gray-800")
              }
            >
              {m.content ? (
                m.role === "assistant" ? renderLight(m.content) : <span className="whitespace-pre-wrap">{m.content}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 opacity-70">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-500" />
                  {status ?? "Thinking"}
                </span>
              )}
            </div>
            {m.role === "assistant" && m.content && metaByIndex[i] ? footer(metaByIndex[i]) : null}
          </div>
        ))}
        {busy && status && messages[messages.length - 1]?.content ? (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-kelly-50 px-2.5 py-1 text-xs text-pine-900">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-kelly-500" />
            {status}
          </p>
        ) : null}
      </div>
      {err ? <p className="pb-1 text-sm text-red-600">{err}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="flex gap-2 pt-1"
      >
        <input
          value={input}
          autoFocus={autoFocus}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your land..."
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-kelly-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
