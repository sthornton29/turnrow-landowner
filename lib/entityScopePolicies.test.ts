import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Mirror test for migration 0034 (the easements.test.ts convention:
// TypeScript and SQL kept in lockstep). Every table that holds
// entity-reachable data must carry a RESTRICTIVE _entity_scope policy;
// a future table added without one fails here instead of silently
// shipping org-wide reads to user-role members.

// 0037 recreates two of 0034's policies (the read-after-write fix), so
// the hoisting and cast rules below cover both files. The hoist rule
// applies to POLICY bodies only (function bodies call helpers
// directly), so each file contributes from its first policy onward.
const sql34 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0034_roles_entity_access.sql"),
  "utf8"
);
const sql37 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0037_entity_scope_read_after_write.sql"),
  "utf8"
);
// 0040 adds lease_assumption_drift with its own restrictive policy in
// the same shape; the hoist and cast rules cover it too.
const sql40 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0040_farm_sync_drift.sql"),
  "utf8"
);
const sql = sql34 + sql37 + sql40;
const policyBlocks =
  sql34.slice(sql34.indexOf("-- ---- properties: the root")) +
  sql37.slice(sql37.indexOf("drop policy if exists documents_entity_scope")) +
  sql40.slice(sql40.indexOf("drop policy if exists lease_assumption_drift_all"));

// The scoped-table list. Deliberately absent (documented in the
// migration header): tenants, farm_connections (reads), county_tax_defaults,
// farm_marketing_prices, assistant_usage, profiles, invites, organizations.
const SCOPED_TABLES = [
  "properties",
  "entities",
  "entity_aliases",
  "entity_accounts",
  "parcels",
  "fields",
  "pastures",
  "wetlands",
  "timber_stands",
  "roads",
  "cemeteries",
  "land_sections",
  "property_aliases",
  "timber_scans",
  "assets",
  "easements",
  "maintenance_issues",
  "leases",
  "lease_lands",
  "lease_year_assumptions",
  "lease_assumption_drift",
  "expected_payments",
  "payments",
  "timber_sales",
  "timber_sale_stands",
  "timber_settlements",
  "tax_statements",
  "tax_statement_lines",
  "tax_payments",
  "parcel_identifiers",
  "fsa_farms",
  "fsa_farm_properties",
  "fsa_base_acres",
  "fsa_elections",
  "field_mappings",
  "farm_field_data",
  "farm_projected_yields",
  "documents",
  "document_properties",
  "document_versions",
];

describe("migration 0034 entity scoping", () => {
  it("carries a restrictive _entity_scope policy for every scoped table", () => {
    for (const table of SCOPED_TABLES) {
      const pattern = new RegExp(
        `create policy ${table}_entity_scope on public\\.${table}\\s+as restrictive`,
        "i"
      );
      expect(sql, `missing restrictive policy for ${table}`).toMatch(pattern);
    }
  });

  it("gates farm_connections writes per command without touching reads", () => {
    expect(sql).toMatch(/farm_connections_admin_insert on public\.farm_connections\s+as restrictive for insert/i);
    expect(sql).toMatch(/farm_connections_admin_update on public\.farm_connections\s+as restrictive for update/i);
    expect(sql).toMatch(/farm_connections_admin_delete on public\.farm_connections\s+as restrictive for delete/i);
    expect(sql).not.toMatch(/on public\.farm_connections\s+as restrictive for select/i);
    expect(sql).not.toMatch(/on public\.farm_connections\s+as restrictive for all/i);
  });

  it("renames the roles and keeps the invite default in step", () => {
    expect(sql).toMatch(/check \(role in \('admin', 'user'\)\)/);
    expect(sql).toMatch(/set role = 'admin' where role = 'owner'/);
    expect(sql).toMatch(/set role = 'user'\s+where role = 'member'/);
    expect(sql).toMatch(/alter column role set default 'user'/);
  });

  it("hoists every helper call in policy expressions (no bare per-row calls)", () => {
    // The policy bodies must use the (select private.fn()) InitPlan form.
    // can_access_remote_field/attachment/document take row columns as
    // arguments and are the only intentionally per-row helpers.
    const bare = policyBlocks.match(
      /(?<!\(select )private\.user_(is_admin|entity_ids|accessible_\w+)\(\)/g
    );
    expect(bare ?? []).toEqual([]);
  });

  it("casts every hoisted array subselect to uuid[] (ANY parses a bare subquery as rows)", () => {
    // "= any((select fn()))" is the SUBQUERY form of ANY: Postgres
    // compares uuid to each uuid[] ROW and fails with "operator does
    // not exist: uuid = uuid[]" (the exact error the first run of 0034
    // hit). The ::uuid[] cast forces the ARRAY form.
    const uncast = sql.match(/any\(\(select private\.[a-z_]+\(\)\)(?!::uuid\[\])/g);
    expect(uncast ?? []).toEqual([]);
  });
});
