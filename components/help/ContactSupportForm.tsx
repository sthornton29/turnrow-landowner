"use client";

// Contact support: emails support via /api/support-contact with the user's
// context attached server side. Optional screenshot (image, under 2 MB).
// When the how-to chat escalates, its transcript arrives via the prop and
// rides along in the email body.

import { useEffect, useState } from "react";
import { MAX_SCREENSHOT_BYTES } from "@/lib/supportRequest";

// The unsent message is kept for this browser tab, so closing the help
// sheet (or a send that failed) does not throw away what was typed.
const DRAFT_KEY = "turnrow.support.draft";
// Long enough for a 2 MB screenshot on a weak signal, short enough that
// "Sending..." cannot sit there forever.
const SEND_TIMEOUT_MS = 60_000;

export default function ContactSupportForm({
  pathname,
  transcript,
}: {
  pathname: string;
  transcript?: string;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [shot, setShot] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Bring back an unsent draft after mount, then keep it saved as it changes.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? "null") as {
        subject?: unknown;
        message?: unknown;
      } | null;
      if (typeof saved?.subject === "string") setSubject(saved.subject);
      if (typeof saved?.message === "string") setMessage(saved.message);
    } catch {
      // No saved draft, or storage is unavailable: start empty.
    }
    setDraftLoaded(true);
  }, []);
  useEffect(() => {
    if (!draftLoaded) return;
    try {
      if (subject || message) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ subject, message }));
      else window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Storage is unavailable: the draft still lives while the form is open.
    }
  }, [draftLoaded, subject, message]);

  function pickShot(file: File | undefined) {
    setErr(null);
    if (!file) {
      setShot(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setErr("Screenshots must be an image file.");
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setErr("That image is over 2 MB. Crop or resize it and try again.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setShot({ name: file.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!message.trim()) {
      setErr("Tell us what you need help with.");
      return;
    }
    setBusy(true);
    // With no signal the request fails or never answers. Either way the
    // form says so in plain words and keeps the message.
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch("/api/support-contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim() || "Support request",
          message: message.trim(),
          pathname,
          transcript: transcript || undefined,
          screenshot: shot?.dataUrl,
          screenshotName: shot?.name,
        }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(json?.error ?? "Could not send. Try again in a minute.");
        return;
      }
      try {
        window.sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // Nothing to clear.
      }
      setSubject("");
      setMessage("");
      setSent(true);
    } catch {
      setErr(
        "Your message was not sent. Check your connection and try Send to support again. What you wrote is still here."
      );
    } finally {
      window.clearTimeout(timer);
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-2 pt-8 text-center">
        <p className="text-3xl" aria-hidden>
          &#10003;
        </p>
        <p className="font-semibold text-gray-900">Message sent.</p>
        <p className="text-sm text-gray-500">
          Support will reply to your email address, usually the same day.
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-kelly-500 focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-3 pt-2">
      <p className="text-xs text-gray-500">
        Goes straight to Turnrow support with your email, organization, and current page attached.
        No need to explain where you are.
      </p>
      {transcript ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900">
          Your conversation with the how-to chat will be included.
        </p>
      ) : null}
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className={inputClass}
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        placeholder="What do you need help with?"
        className={inputClass}
      />
      <label className="block text-xs text-gray-500">
        Screenshot (optional, image up to 2 MB)
        <input
          type="file"
          accept="image/*"
          onChange={(e) => pickShot(e.target.files?.[0])}
          className="mt-1 block w-full text-xs text-gray-700"
        />
      </label>
      {shot ? <p className="text-xs text-gray-600">Attached: {shot.name}</p> : null}
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-50"
      >
        {busy ? "Sending..." : "Send to support"}
      </button>
    </form>
  );
}
