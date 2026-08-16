"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/format";
import { deleteEntity, mergeEntity } from "../actions";

// Merge and delete for an entity (owner role only; the page hides this
// for members and the server actions verify again). Both spell out
// exactly what will happen before anything runs.
export default function EntityDangerZone({
  entityId,
  entityName,
  targets,
  propertyCount,
  aliasCount,
  documentCount,
}: {
  entityId: string;
  entityName: string;
  targets: Array<{ id: string; name: string }>;
  propertyCount: number;
  aliasCount: number;
  documentCount: number;
}) {
  const [merging, setMerging] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);

  const targetName = targets.find((t) => t.id === targetId)?.name ?? "";
  const counts = (count: number, noun: string, plural?: string) =>
    `${formatNumber(count)} ${count === 1 ? noun : (plural ?? noun + "s")}`;

  async function remove() {
    const message = [
      `Delete "${entityName}"?`,
      `${counts(propertyCount, "property", "properties")} revert to No entity (properties are never deleted).`,
      `${counts(aliasCount, "saved county spelling")} ${aliasCount === 1 ? "is" : "are"} removed.`,
      documentCount > 0
        ? `${counts(documentCount, "attached document")} ${documentCount === 1 ? "is" : "are"} deleted with ${documentCount === 1 ? "its file" : "their files"}.`
        : null,
      "This cannot be undone.",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!window.confirm(message)) return;
    setBusy(true);
    const formData = new FormData();
    formData.set("id", entityId);
    await deleteEntity(formData);
  }

  return (
    <section className="space-y-3 border-t border-gray-200 pt-4">
      {targets.length > 0 ? (
        !merging ? (
          <button
            onClick={() => setMerging(true)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Merge into another entity
          </button>
        ) : (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-amber-900">
                Merge {'"'}
                {entityName}
                {'"'} into
              </span>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Pick an entity...</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  setMerging(false);
                  setTargetId("");
                }}
                className="text-sm text-gray-600 hover:underline"
              >
                Cancel
              </button>
            </div>
            {targetId ? (
              <form action={mergeEntity} className="space-y-2">
                <input type="hidden" name="source_id" value={entityId} />
                <input type="hidden" name="target_id" value={targetId} />
                <p className="text-sm text-amber-900">
                  {counts(propertyCount, "property", "properties")},{" "}
                  {counts(aliasCount, "saved county spelling")}, and{" "}
                  {counts(documentCount, "document")} move to{" "}
                  <span className="font-semibold">{targetName}</span>. {'"'}
                  {entityName}
                  {'"'} is then removed. This cannot be undone.
                </p>
                <button
                  type="submit"
                  className="rounded-lg bg-pine-800 px-4 py-2 text-sm font-semibold text-white hover:bg-pine-900"
                >
                  Confirm merge into {targetName}
                </button>
              </form>
            ) : null}
          </div>
        )
      ) : null}

      <div>
        <button
          onClick={remove}
          disabled={busy}
          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
        >
          {busy ? "Deleting..." : "Delete entity"}
        </button>
        <p className="mt-1 text-xs text-gray-500">
          Its properties are kept and become unassigned. Saved county
          spellings are removed, and attached documents are deleted with
          their files.
        </p>
      </div>
    </section>
  );
}
