"use client";

import { useState } from "react";
import type { TimberAccountProductRow, TimberAccountRow } from "@/types/db";
import BasisSetupForm from "./BasisSetupForm";

// A button that opens the basis setup interview in place.
export default function BasisSetupLauncher({
  label,
  primary = true,
  ...formProps
}: {
  label: string;
  primary?: boolean;
  orgId: string;
  property: { id: string; name: string; entity_id: string | null };
  entities: Array<{ id: string; name: string }>;
  account: TimberAccountRow | null;
  products: TimberAccountProductRow[];
  defaultAcres: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (open) return <BasisSetupForm {...formProps} onClose={() => setOpen(false)} />;
  return (
    <button
      onClick={() => setOpen(true)}
      className={
        primary
          ? "rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600"
          : "text-sm font-medium text-kelly-700 hover:underline"
      }
    >
      {label}
    </button>
  );
}
