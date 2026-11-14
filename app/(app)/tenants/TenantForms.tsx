"use client";

// The tenant forms (new, edit, delete). They call the server actions in
// actions.ts from the submit handler, so a save that fails shows a plain
// reason beside the button, the form keeps what was typed, and the button
// is disabled while the request is in flight (a double tap cannot create
// two tenants).

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { plural } from "@/lib/format";
import { createTenant, deleteTenant, updateTenant, type TenantActionResult } from "./actions";

const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

// Runs one action for a form: busy while it is in flight, the action's
// sentence on failure. A dropped connection never reaches the action, so
// that case gets its own sentence here.
function useTenantAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(
    action: (formData: FormData) => Promise<TenantActionResult>,
    formData: FormData
  ): Promise<TenantActionResult | null> {
    if (busy) return null;
    setBusy(true);
    setError(null);
    let result: TenantActionResult;
    try {
      result = await action(formData);
    } catch {
      result = { ok: false, error: "Could not reach the server. Check your connection and try again." };
    }
    setBusy(false);
    if (!result.ok) setError(result.error);
    return result;
  }
  return { busy, error, run };
}

export function NewTenantForm() {
  const router = useRouter();
  const { busy, error, run } = useTenantAction();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = await run(createTenant, new FormData(e.currentTarget));
    if (result?.ok && result.id) router.push(`/tenants/${result.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap gap-2 px-4 pb-4">
      <input
        name="name"
        required
        placeholder="Name (person or entity)"
        className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <input
        name="contact_person"
        placeholder="Contact person"
        className="w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <input
        name="phone"
        placeholder="Phone"
        className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <input
        name="email"
        type="email"
        placeholder="Email"
        className="w-52 rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
      >
        {busy ? "Creating..." : "Create"}
      </button>
      {error ? <p className="w-full text-sm text-red-600">{error}</p> : null}
    </form>
  );
}

export interface TenantFormValues {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  mailing_address: string | null;
  insurance_on_file: boolean;
  insurance_expires: string | null;
  notes: string | null;
}

export function TenantEditForm({ tenant }: { tenant: TenantFormValues }) {
  const router = useRouter();
  const { busy, error, run } = useTenantAction();
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const result = await run(updateTenant, new FormData(e.currentTarget));
    if (result?.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      onChange={() => setSaved(false)}
      className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
    >
      <input type="hidden" name="id" value={tenant.id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
          <input name="name" defaultValue={tenant.name} required className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Contact person</label>
          <input name="contact_person" defaultValue={tenant.contact_person ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Phone</label>
          <input name="phone" defaultValue={tenant.phone ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <input name="email" type="email" defaultValue={tenant.email ?? ""} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-700">Mailing address</label>
          <textarea
            name="mailing_address"
            rows={2}
            defaultValue={tenant.mailing_address ?? ""}
            className={inputClass}
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              name="insurance_on_file"
              defaultChecked={tenant.insurance_on_file}
              className="h-4 w-4 accent-kelly-500"
            />
            Insurance certificate on file
          </label>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Insurance expires
          </label>
          <input
            name="insurance_expires"
            type="date"
            defaultValue={tenant.insurance_expires ?? ""}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
          <textarea name="notes" rows={2} defaultValue={tenant.notes ?? ""} className={inputClass} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save changes"}
        </button>
        {saved ? <span className="text-sm text-pine-900">Saved.</span> : null}
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>
    </form>
  );
}

// leaseCount: the leases this person can see for the tenant. The
// database refuses to delete a tenant that holds any lease, so with
// leases in view the button explains instead of trying.
export function DeleteTenantButton({
  tenantId,
  tenantName,
  leaseCount,
}: {
  tenantId: string;
  tenantName: string;
  leaseCount: number;
}) {
  const router = useRouter();
  const { busy, error, run } = useTenantAction();

  async function onDelete() {
    if (
      !window.confirm(
        `Delete the tenant "${tenantName}"? This cannot be undone.\n\n` +
          "Leases: none are deleted. A tenant can only be deleted when it has no leases.\n\n" +
          "Documents: the files attached to this tenant (insurance certificates, W-9s) are not deleted. They stay in Documents but will no longer be attached to a tenant.\n\n" +
          "Timber sales that list this tenant as the buyer keep the buyer's name."
      )
    ) {
      return;
    }
    const formData = new FormData();
    formData.set("id", tenantId);
    const result = await run(deleteTenant, formData);
    if (result?.ok) router.push("/tenants");
  }

  return (
    <div>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy || leaseCount > 0}
        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {busy ? "Deleting..." : "Delete tenant"}
      </button>
      <p className="mt-1 text-xs text-gray-500">
        {leaseCount > 0
          ? `This tenant has ${plural(leaseCount, "lease")}, so it cannot be deleted. Delete those leases, or move them to another tenant, first.`
          : "Only possible when the tenant has no leases (delete or reassign those first)."}
      </p>
      {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
