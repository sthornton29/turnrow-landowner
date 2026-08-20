"use client";

// Contact support: emails support via /api/support-contact with the user's
// context attached server side. Optional screenshot (image, under 2 MB).
// When the how-to chat escalates, its transcript arrives via the prop and
// rides along in the email body.

import { useState } from "react";
import { MAX_SCREENSHOT_BYTES } from "@/lib/supportRequest";

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
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(json?.error ?? "Could not send. Try again in a minute.");
      return;
    }
    setSent(true);
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
