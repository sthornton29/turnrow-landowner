---
title: Members, roles, and who sees what
route: /settings
group: Settings
order: 2
updated: 2026-11-14
keywords: members, roles, admin, user, invite, sign-up link, entity access, permissions, who can see, grant, restrict, entities, remove member, empty account
---
## The two roles

Every member of your organization is an **admin** or a **user**.

- **Admins** see everything and manage everything: land, leases, taxes, documents, farm data, members, and access.
- **Users** see only the data belonging to the **entities** ticked for them: those entities' properties and everything on them (parcels, ag fields, timber, roads, easements, assets), plus the leases, income, taxes, documents, FSA farms, and shared farm data that reach the land through those properties. A user with no entities ticked sees an empty account until an admin ticks some.

The rule is enforced in the database itself, not just hidden in menus: a restricted user cannot reach another entity's records through any page, export, print, stored file, or the Ask assistant.

## Changing someone's role or access

On Settings under Members, each member other than you has a **Role** choice. For a user, a **Can see** list appears with a box per entity. Tick the entities they should see and tap **Save**. One Save covers both the role and the boxes, and a line under the button says what was saved or why it was not.

You cannot change your own role, so there is always at least one admin.

## Inviting someone

1. Under **Invite someone**, enter their email, pick the role, and for a user tick at least one entity.
2. Tap **Invite**. The invitation is saved, but **no email is sent from here**.
3. Send them the **sign-up link** shown below the form yourself, by text or email. **Copy link** copies it.
4. They create their account with that same email address and are connected automatically with the role and access you chose.

Waiting invitations are listed under **Invited, not signed up yet**. **Revoke** removes one. To change a waiting invitation, invite the same address again; the new choices replace the old.

## Removing someone

Tap **Remove from account** on their row and confirm. They can no longer see anything on this account. Their sign-in is not deleted, so inviting the same address again later reconnects them. Documents they uploaded stay.

## Records visible to admins only

A user reaches a record through the entity that owns its land. A record that is not tied to any entity is visible to admins only; unassigned never means visible to everyone. An amber notice in the Members section lists these so the gap is deliberate and not an accident:

- a property with no entity;
- an asset, easement, or open maintenance issue with no property;
- a lease with no land listed, a timber sale with no stands, an FSA farm not linked to a property;
- an income record with neither a property nor an entity;
- an unfiled document.

Documents attached to a tenant are always admin-only. The tenants themselves (names and contact details) are visible to every member.

## Common questions

- **A user says the app is empty.** They have no entities ticked yet, or their entities hold no properties. Tick entities for them on Settings, and check the amber notice.
- **Can a user create leases or upload tax statements?** No; creating leases, timber sales, FSA farms, tax statements, and farm connections is admin work. Users view and edit within their entities.
- **Can a user see tenants?** Yes. Tenant names and contact details are shared across the organization so lease pages read correctly for everyone.
- **Someone was invited but cannot get in.** They most likely signed up with a different email address than the one invited. See "Signing in, your password, and getting connected".
