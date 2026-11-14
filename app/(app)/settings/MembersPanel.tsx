"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createInvite,
  deleteInvite,
  removeMember,
  saveMember,
  type SettingsFormState,
} from "./actions";

// The Members section of Settings. Every form reports what happened in
// a sentence beside it (saved, or why not), and the two actions that
// take access away (Remove, Revoke) ask a second time first.

type Member = { id: string; full_name: string | null; email: string; role: string | null };
type Invite = { id: string; email: string; role: string; entity_ids: string[] | null };
type Entity = { id: string; name: string };

const initial: SettingsFormState = { error: null, message: null };

function Feedback({ state }: { state: SettingsFormState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-sm text-red-600">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="mt-2 text-sm text-pine-900">
        {state.message}
      </p>
    );
  }
  return null;
}

const smallButton =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60";

function EntityChecks({
  entities,
  checked,
  disabled,
}: {
  entities: Entity[];
  checked: Set<string>;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
      {entities.map((e) => (
        <label
          key={e.id}
          className={
            "flex cursor-pointer items-center gap-2.5 py-2 text-sm " +
            (disabled ? "text-gray-400" : "text-gray-800")
          }
        >
          <input
            type="checkbox"
            name="entity_ids"
            value={e.id}
            defaultChecked={checked.has(e.id)}
            disabled={disabled}
            className="h-5 w-5 shrink-0 accent-kelly-500"
          />
          {e.name}
        </label>
      ))}
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  isAdmin,
  entities,
  granted,
}: {
  member: Member;
  isSelf: boolean;
  isAdmin: boolean;
  entities: Entity[];
  granted: string[];
}) {
  const [saveState, saveAction, saving] = useActionState(saveMember, initial);
  const [removeState, removeAction, removing] = useActionState(removeMember, initial);
  const [role, setRole] = useState(member.role === "admin" ? "admin" : "user");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const name = member.full_name || member.email;
  const canEdit = isAdmin && !isSelf;

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">
            {name}
            {isSelf ? <span className="ml-1 text-sm font-normal text-gray-400">(you)</span> : null}
          </p>
          <p className="break-all text-sm text-gray-500">{member.email}</p>
        </div>
        {!canEdit ? (
          <span className="rounded-full bg-kelly-50 px-2.5 py-0.5 text-xs font-medium capitalize text-pine-900">
            {member.role ?? "user"}
          </span>
        ) : null}
      </div>

      {canEdit ? (
        <>
          <form action={saveAction} className="mt-3 border-t border-gray-100 pt-3">
            <input type="hidden" name="user_id" value={member.id} />
            <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <span className="font-medium">Role</span>
              <select
                name="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="admin">Admin: sees and manages everything</option>
                <option value="user">User: sees only the entities ticked below</option>
              </select>
            </label>

            {role === "user" ? (
              entities.length === 0 ? (
                <p className="mt-2 text-sm text-amber-700">
                  No entities exist yet. Create entities and assign properties to
                  them, or this person sees nothing.
                </p>
              ) : (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Can see</p>
                  <EntityChecks entities={entities} checked={new Set(granted)} />
                  {granted.length === 0 ? (
                    <p className="text-sm text-amber-700">
                      Nothing is ticked: this person currently sees an empty account.
                    </p>
                  ) : null}
                </div>
              )
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              {!confirmingRemove ? (
                <button type="button" onClick={() => setConfirmingRemove(true)} className={smallButton}>
                  Remove from account
                </button>
              ) : null}
            </div>
            <Feedback state={saveState} />
          </form>

          {confirmingRemove ? (
            <form action={removeAction} className="mt-3 rounded-lg bg-red-50 p-3">
              <input type="hidden" name="user_id" value={member.id} />
              <p className="text-sm text-red-900">
                Remove {name}? They will no longer see anything on this account.
                Their sign-in is not deleted, so you can invite them again later.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={removing}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {removing ? "Removing..." : "Yes, remove"}
                </button>
                <button type="button" onClick={() => setConfirmingRemove(false)} className={smallButton}>
                  Cancel
                </button>
              </div>
              <Feedback state={removeState} />
            </form>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

function InviteRow({ invite, entityName }: { invite: Invite; entityName: Map<string, string> }) {
  const [state, action, pending] = useActionState(deleteInvite, initial);
  const [confirming, setConfirming] = useState(false);
  const ids = invite.entity_ids ?? [];
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all text-sm font-medium text-gray-900">{invite.email}</p>
          <p className="text-xs text-gray-500">
            {invite.role === "admin" ? "Admin" : "User"}
            {invite.role === "user"
              ? ids.length > 0
                ? ": " + ids.map((id) => entityName.get(id) ?? "an entity that was removed").join(", ")
                : ": no entities ticked, so they would see an empty account"
              : null}
            . Waiting for them to sign up.
          </p>
        </div>
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className={smallButton}>
            Revoke
          </button>
        ) : (
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={invite.id} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {pending ? "Removing..." : "Yes, revoke"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={smallButton}>
              Keep
            </button>
          </form>
        )}
      </div>
      <Feedback state={state} />
    </li>
  );
}

function InviteForm({ entities, signupUrl }: { entities: Entity[]; signupUrl: string }) {
  const [state, action, pending] = useActionState(createInvite, initial);
  const [role, setRole] = useState("user");
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form once an invite has been saved.
  useEffect(() => {
    if (state.message) {
      formRef.current?.reset();
      setRole("user");
    }
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(signupUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard not available (older browser, or blocked): the address
      // is on screen to copy by hand.
      setCopied(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Invite someone</h3>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-gray-600">
          <li>Add their email and what they can see, then tap Invite.</li>
          <li>Send them the sign-up link below yourself (text or email). Nothing is emailed from here.</li>
          <li>They sign up with that same email address and are connected automatically.</li>
        </ol>
      </div>

      <form ref={formRef} action={action} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            name="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            placeholder="email@example.com"
            aria-label="Email address to invite"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base sm:text-sm"
          />
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Role"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="user">User: sees only what is ticked</option>
            <option value="admin">Admin: sees and manages everything</option>
          </select>
        </div>

        {role === "user" ? (
          entities.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                This person can see (tick at least one)
              </p>
              <EntityChecks entities={entities} checked={new Set()} />
            </div>
          ) : (
            <p className="text-sm text-amber-700">
              No entities exist yet, so a user would see nothing. Create entities
              and assign properties to them first, or invite this person as an admin.
            </p>
          )
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-kelly-500 px-4 py-2 text-sm font-semibold text-white hover:bg-kelly-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Invite"}
        </button>
        <Feedback state={state} />
      </form>

      <div className="rounded-lg bg-gray-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Sign-up link to send them
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all text-sm text-gray-900">{signupUrl}</code>
          <button type="button" onClick={copy} className={smallButton}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MembersPanel({
  members,
  invites,
  entities,
  access,
  selfId,
  isAdmin,
  signupUrl,
}: {
  members: Member[];
  invites: Invite[];
  entities: Entity[];
  // user id -> the entity ids they are granted (admins only get this)
  access: Record<string, string[]>;
  selfId: string;
  isAdmin: boolean;
  signupUrl: string;
}) {
  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {members.map((m) => (
          <MemberRow
            // Remount when the saved role or grants change so the form
            // starts from what is stored.
            key={`${m.id}:${m.role}:${(access[m.id] ?? []).slice().sort().join(",")}`}
            member={m}
            isSelf={m.id === selfId}
            isAdmin={isAdmin}
            entities={entities}
            granted={access[m.id] ?? []}
          />
        ))}
      </ul>

      {isAdmin ? (
        <>
          <InviteForm entities={entities} signupUrl={signupUrl} />
          {invites.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Invited, not signed up yet</h3>
              <ul className="space-y-2">
                {invites.map((inv) => (
                  <InviteRow key={inv.id} invite={inv} entityName={entityName} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-gray-500">Only admins can invite new members or change access.</p>
      )}
    </div>
  );
}
