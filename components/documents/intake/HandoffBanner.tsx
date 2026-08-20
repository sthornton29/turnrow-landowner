"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HANDOFF_ROUTES, putHandoffFile } from "@/lib/fileHandoff";

const KIND_LABEL: Record<string, string> = {
  lease: "a lease",
  timber_contract: "a timber sale contract",
  timber_settlement: "a timber settlement",
  tax_statement: "a property tax statement",
  rent_payment: "a rent or crop share payment",
};

// The intake recognized a document that has its own specialized flow
// (lease terms, timber contracts and settlements, tax statements, rent
// uploads). One tap hands the file over; nothing is saved here first.
export default function HandoffBanner({
  kind,
  file,
  onDismiss,
}: {
  kind: string;
  file: File;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const route = HANDOFF_ROUTES[kind];
  if (!route) return null;

  async function go() {
    setBusy(true);
    try {
      const key = await putHandoffFile(file);
      router.push(`${route.href}?handoff=${encodeURIComponent(key)}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-sky-300 bg-sky-50 p-3">
      <p className="text-sm font-medium text-sky-900">
        This looks like {KIND_LABEL[kind] ?? "a specialized record"}.
      </p>
      <p className="mt-0.5 text-xs text-sky-900/80">
        It has its own intake that reads the terms and files it in the right place
        (the same review-before-save rules apply there).
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {busy ? "Opening..." : route.label}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100"
        >
          Keep it here as a document
        </button>
      </div>
    </div>
  );
}
