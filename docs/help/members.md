---
title: Members, roles, and who sees what
route: /settings
group: Settings
order: 2
updated: 2026-08-29
keywords: members, roles, admin, user, invite, entity access, permissions, who can see, grant, restrict, entities
---
## The two roles

Every member of your organization is an **admin** or a **user**.

- **Admins** see everything and manage everything: land, leases, taxes, documents, farm data, members, and access.
- **Users** see only the data belonging to the **entities** they are granted: those entities' properties and everything on them (parcels, ag fields, timber, roads, easements, assets), plus the leases, income, taxes, documents, FSA farms, and shared farm data that reach the land through those properties. A user with no granted entities sees an empty app until an admin grants access.

The rule is enforced in the database itself, not just hidden in menus: a restricted user cannot reach another entity's records through any page, export, print, or the Ask assistant.

## Granting access

On Settings under Members, each user-role member shows a "Can see" row with a checkbox per entity. Check the entities they should see and Save access. Admins have no checkboxes; the admin role sees everything.

Roles are changed with the select beside each member. You cannot change your own role, so there is always at least one admin.

## Inviting someone

Invite by email, pick the role, and for a user check their starting entities. When they sign up with that same email they connect automatically with the role and access you chose.

## Records visible to admins only

A property with no entity, or an asset or easement not attached to a property, is visible to admins only; unassigned never means visible to everyone. An amber notice in the Members section lists these records so they get assigned.

## Common questions

- **A user says the app is empty.** They have no entity grants yet, or their entities hold no properties. Grant entities on Settings, and check the amber unassigned notice.
- **Can a user create leases or upload tax statements?** No; creating organization records (leases, timber sales, FSA farms, tax statements, tenants, farm connections) is admin work. Users view and edit within their entities.
- **Do tenant contacts stay visible?** Yes, tenant names and contact details are organization-wide so lease pages read correctly for everyone.
