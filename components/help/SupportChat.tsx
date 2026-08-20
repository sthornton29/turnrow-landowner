"use client";

// The how-to chat inside the help drawer. It knows how the app works (the
// compiled help) and nothing about the user's data. Session only (nothing
// persists), streams the reply, and always offers escalation into Contact
// support with the conversation carried along.

import { useRef, useState } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function SupportChat({
  pathname,
  onEscalate,
}: {
  pathname: string;
  onEscalate: (transcript: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  function transcript(): string {
    return messages
      .map((m) => `${m.role === "user" ? "Me" : "Assistant"}: ${m.content}`)
      .join("\n\n");
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setErr(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/support-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next, pathname }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "The help chat is unavailable right now.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const current = acc;
        setMessages([...next, { role: "assistant", content: current }]);
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
      if (!acc.trim()) throw new Error("No answer came back. Try again, or contact support.");
    } catch (error) {
      setMessages(next);
      setErr(error instanceof Error ? error.message : "The help chat is unavailable right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-[50vh] flex-col">
      <p className="border-b border-gray-100 pb-2 text-xs text-gray-500">
        I know how the app works; for questions about your own land and numbers use{" "}
        <a href="/ask" className="font-semibold text-kelly-700 hover:underline">
          Ask
        </a>
        .
      </p>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
        {messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-gray-400">
            Ask anything about using the app: &ldquo;How do I draw an easement?&rdquo;,
            &ldquo;Where do I record a rent check?&rdquo;
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm " +
                (m.role === "user"
                  ? "rounded-br-sm bg-kelly-500 text-white"
                  : "rounded-bl-sm bg-gray-100 text-gray-800")
              }
            >
              {m.content || <span className="opacity-60">...</span>}
            </div>
          </div>
        ))}
      </div>
      {err ? <p className="pb-1 text-sm text-red-600">{err}</p> : null}
      <form onSubmit={send} className="flex gap-2 pt-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a question"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {messages.length > 0 ? (
        <button
          type="button"
          onClick={() => onEscalate(transcript())}
          className="mt-2 self-start text-xs text-gray-500 underline decoration-dotted"
        >
          Did not get what you needed? Send this conversation to support
        </button>
      ) : null}
    </div>
  );
}
