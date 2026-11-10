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
// 0043 adds pollinator_habitats with its own restrictive policy, in
// the same form; it joins the checked text so the table list below
// can require it.
const sql43 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0043_pollinator_habitats.sql"),
  "utf8"
);
// 0045 adds the timber record tables (activities, their stands, costs).
const sql45 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0045_timber_records.sql"),
  "utf8"
);
// 0046 adds timber basis accounts, their products, and the ledger.
const sql46 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0046_timber_basis.sql"),
  "utf8"
);
// 0047 adds cost-share awards and payments.
const sql47 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0047_cost_share.sql"),
  "utf8"
);
// 0048 adds sealed bids on timber sales.
const sql48 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0048_timber_sale_workflow.sql"),
  "utf8"
);
// 0049 adds the yearly county-record snapshots.
const sql49 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0049_tax_report_data.sql"),
  "utf8"
);
// 0050 adds the valuation notice log.
const sql50 = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0050_tax_report_finish.sql"),
  "utf8"
);
const sql = sql34 + sql37 + sql43 + sql45 + sql46 + sql47 + sql48 + sql49 + sql50;
const policyBlocks =
  sql34.slice(sql34.indexOf("-- ---- properties: the root")) +
  sql37.slice(sql37.indexOf("drop policy if exists documents_entity_scope")) +
  sql43.slice(
    sql43.indexOf("create policy pollinator_habitats_entity_scope"),
    sql43.indexOf("create trigger set_updated_at before update on public.pollinator_habitats")
  ) +
  sql45.slice(
    sql45.indexOf("create policy stand_activities_all"),
    sql45.indexOf("-- ---------------------------------------------------------------- save_stand_activity")
  ) +
  sql46.slice(
    sql46.indexOf("create policy timber_accounts_all"),
    sql46.indexOf("create or replace function private.user_accessible_timber_account_ids")
  ) +
  sql46.slice(
    sql46.indexOf("-- ---------------------------------------------------------------- timber_account_products"),
    sql46.indexOf("-- ---------------------------------------------------------------- documents")
  ) +
  sql47.slice(
    sql47.indexOf("create policy cost_share_awards_all"),
    sql47.indexOf("create or replace function private.user_accessible_cost_share_award_ids")
  ) +
  sql47.slice(
    sql47.indexOf("-- ---------------------------------------------------------------- cost_share_payments"),
    sql47.indexOf("-- ---------------------------------------------------------------- timber_costs link")
  ) +
  sql48.slice(sql48.indexOf("create policy timber_sale_bids_all")) +
  sql49.slice(
    sql49.indexOf("create policy parcel_valuations_all"),
    sql49.indexOf("create index parcel_valuations_org_idx")
  ) +
  sql50.slice(
    sql50.indexOf("create policy tax_valuation_notices_all"),
    sql50.indexOf("create index tax_valuation_notices_org_idx")
  );

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
  "pollinator_habitats",
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
  "expected_payments",
  "payments",
  "timber_sales",
  "timber_sale_stands",
  "timber_settlements",
  "stand_activities",
  "stand_activity_stands",
  "timber_costs",
  "timber_accounts",
  "timber_account_products",
  "timber_account_entries",
  "cost_share_awards",
  "cost_share_payments",
  "timber_sale_bids",
  "parcel_valuations",
  "tax_valuation_notices",
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
