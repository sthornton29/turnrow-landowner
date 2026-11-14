"use client";

import { useActionState } from "react";
import { createProperty, type NewPropertyState } from "./actions";

const initialState: NewPropertyState = { error: null, created: null };

// The "+ New property" form on the Properties page (admins only; the
// page decides). A property made here has no boundary yet: draw it on
// the map or import it afterward. The server action hands back why a
// save failed, so a refused or dropped save never looks like a success.
export default function NewPropertyForm({
  entities,
}: {
  entities: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(createProperty, initialState);

  return (
    <form action={formAction} className="flex flex-wrap gap-2 px-4 pb-4">
      <input
        name="name"
        required
        defaultValue={state.values?.name ?? ""}
        placeholder="Property name"
        className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <input
        name="county"
        defaultValue={state.values?.county ?? ""}
        placeholder="County"
        className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <input
        name="state"
        defaultValue={state.values?.state ?? ""}
        placeholder="State"
        className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <input
        name="fsa_numbers"
        defaultValue={state.values?.fsa_numbers ?? ""}
        placeholder="FSA numbers (comma separated, optional)"
        className="min-w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      {entities.length > 0 ? (
        <select
          name="entity_id"
          defaultValue={state.values?.entity_id ?? ""}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">No entity</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create"}
      </button>
      {state.error ? (
        <p role="alert" className="w-full text-sm text-red-600">
          {state.error}
        </p>
      ) : state.created ? (
        <p role="status" className="w-full text-sm text-pine-900">
          {state.created} was created. Draw its boundary on the map, or import it.
        </p>
      ) : null}
    </form>
  );
}
