"use client";

import { startTransition, useActionState, useState } from "react";
import { formatNumber } from "@/lib/format";
import { deleteEntity, mergeEntity, type EntityActionState } from "../actions";

// Everything besides properties, county spellings, and documents that
// hangs on an entity by foreign key (counted by the page). Deleting the
// entity unlinks or removes each of these; merging moves each of them.
export interface EntityLinkedCounts {
  taxStatements: number;
  taxAccounts: number;
  members: number;
  timberAccounts: number;
  costShareAwards: number;
  incomeRecords: number;
}

const noError: EntityActionState = { error: null };

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
  linked,
}: {
  entityId: string;
  entityName: string;
  targets: Array<{ id: string; name: string }>;
  propertyCount: number;
  aliasCount: number;
  documentCount: number;
  linked: EntityLinkedCounts;
}) {
  const [merging, setMerging] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [mergeState, mergeAction, mergePending] = useActionState(mergeEntity, noError);
  // On success the action sends the browser to the Entities list; it
  // only comes back with a sentence when the delete did not happen.
  const [deleteState, deleteAction, busy] = useActionState(deleteEntity, noError);

  const targetName = targets.find((t) => t.id === targetId)?.name ?? "";
  const counts = (count: number, noun: string, plural?: string) =>
    `${formatNumber(count)} ${count === 1 ? noun : (plural ?? noun + "s")}`;
  const isAre = (count: number) => (count === 1 ? "is" : "are");

  function remove() {
    // Only what this entity actually has is listed.
    const kept = [
      linked.timberAccounts > 0 ? counts(linked.timberAccounts, "timber basis account") : null,
      linked.costShareAwards > 0 ? counts(linked.costShareAwards, "cost-share award") : null,
      linked.incomeRecords > 0 ? counts(linked.incomeRecords, "income record") : null,
    ].filter(Boolean);
    const keptCount = linked.timberAccounts + linked.costShareAwards + linked.incomeRecords;
    const message = [
      `Delete "${entityName}"?`,
      `${counts(propertyCount, "property", "properties")} ${propertyCount === 1 ? "reverts" : "revert"} to No entity (properties are never deleted).`,
      `${counts(aliasCount, "saved county spelling")} ${isAre(aliasCount)} removed.`,
      documentCount > 0
        ? `${counts(documentCount, "attached document")} ${isAre(documentCount)} deleted with ${documentCount === 1 ? "its file" : "their files"}.`
        : null,
      linked.taxStatements > 0
        ? `${counts(linked.taxStatements, "tax statement")} ${isAre(linked.taxStatements)} kept, with ${linked.taxStatements === 1 ? "its" : "their"} payments, but no longer tied to an entity.`
        : null,
      linked.taxAccounts > 0
        ? `${counts(linked.taxAccounts, "registered tax account")} ${isAre(linked.taxAccounts)} removed, so next year's statements from ${linked.taxAccounts === 1 ? "that account" : "those accounts"} will not be matched to an entity on their own.`
        : null,
      linked.members > 0
        ? `${counts(linked.members, "member")} ${linked.members === 1 ? "loses" : "lose"} the access given through this entity. A member with no other entity will see no land.`
        : null,
      kept.length > 0
        ? `${kept.join(", ")} ${isAre(keptCount)} kept but no longer tied to an entity.`
        : null,
      "To keep all of this together, merge into another entity instead.",
      "This cannot be undone.",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!window.confirm(message)) return;
    const formData = new FormData();
    formData.set("id", entityId);
    startTransition(() => deleteAction(formData));
  }

  // What a merge moves, named only when there is some of it.
  const moved = [
    counts(propertyCount, "property", "properties"),
    aliasCount > 0 ? counts(aliasCount, "saved county spelling") : null,
    documentCount > 0 ? counts(documentCount, "document") : null,
    linked.taxStatements > 0 ? counts(linked.taxStatements, "tax statement") : null,
    linked.taxAccounts > 0 ? counts(linked.taxAccounts, "registered tax account") : null,
    linked.timberAccounts > 0 ? counts(linked.timberAccounts, "timber basis account") : null,
    linked.costShareAwards > 0 ? counts(linked.costShareAwards, "cost-share award") : null,
    linked.incomeRecords > 0 ? counts(linked.incomeRecords, "income record") : null,
  ].filter((part): part is string => part !== null);
  const movedText =
    moved.length > 1 ? `${moved.slice(0, -1).join(", ")}, and ${moved[moved.length - 1]}` : moved[0];
  const movedCount =
    propertyCount + aliasCount + documentCount + linked.taxStatements + linked.taxAccounts +
    linked.timberAccounts + linked.costShareAwards + linked.incomeRecords;

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
              <form action={mergeAction} className="space-y-2">
                <input type="hidden" name="source_id" value={entityId} />
                <input type="hidden" name="target_id" value={targetId} />
                <p className="text-sm text-amber-900">
                  {movedText} {movedCount === 1 ? "moves" : "move"} to{" "}
                  <span className="font-semibold">{targetName}</span>.{" "}
                  {linked.members > 0
                    ? `${counts(linked.members, "member")} who could see "${entityName}" will be able to see everything under ${targetName} instead. `
                    : ""}
                  {'"'}
                  {entityName}
                  {'"'} is then removed. This cannot be undone.
                </p>
                {mergeState.error ? (
                  <p aria-live="polite" className="text-sm text-red-700">
                    {mergeState.error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={mergePending}
                  className="rounded-lg bg-pine-800 px-4 py-2 text-sm font-semibold text-white hover:bg-pine-900 disabled:opacity-60"
                >
                  {mergePending ? "Merging..." : `Confirm merge into ${targetName}`}
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
        {deleteState.error ? (
          <p aria-live="polite" className="mt-1 text-sm text-red-600">
            {deleteState.error}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-gray-500">
          Its properties are kept and become unassigned. Saved county
          spellings and registered tax accounts are removed, attached
          documents are deleted with their files, and members lose the
          access given through it. Tax statements, timber basis accounts,
          cost-share awards, and income records are kept but no longer tied
          to an entity. You will see the exact counts before anything is
          deleted.
        </p>
      </div>
    </section>
  );
}
