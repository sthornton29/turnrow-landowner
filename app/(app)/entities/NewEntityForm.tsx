"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { ENTITY_TYPE_LABELS } from "@/lib/entities";
import { createEntity, type EntityActionState } from "./actions";

const initialState: EntityActionState = { error: null };

// "+ New entity" (admins only; the page hides it for everyone else). The
// server action answers with a plain sentence when the entity was not
// created; the button is disabled while it runs, and what was typed
// stays in the form until the entity is saved.
export default function NewEntityForm() {
  const [state, formAction, pending] = useActionState(createEntity, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form only once the entity exists.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      // Submitted by hand rather than through the form's action so a
      // failed save does not reset the fields.
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className="flex flex-wrap gap-2 px-4 pb-4"
    >
      <input
        name="name"
        required
        placeholder="Entity name (e.g. Thornton Family Farms LLC)"
        className="min-w-56 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <select
        name="entity_type"
        defaultValue="llc"
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
      >
        {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create"}
      </button>
      {state.error ? (
        <p aria-live="polite" className="basis-full text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
