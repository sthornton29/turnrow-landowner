import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { ALLOWED_CALLS, BLOCKED_SCHEMAS, guardSql } from "./assistantSql";

// Mirrors the rules in supabase/migrations/0052_assistant_query_allowlist.sql.
// The DB function is the enforcing copy; this guard only saves a round trip.
const MIGRATION = fs.readFileSync(
  path.join(process.cwd(), "supabase", "migrations", "0052_assistant_query_allowlist.sql"),
  "utf8"
);

describe("guardSql", () => {
  it("accepts a plain SELECT and strips one trailing semicolon", () => {
    const r = guardSql("select name, acres from properties_geo order by name;");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sql.endsWith(";")).toBe(false);
  });

  it("accepts WITH ... SELECT", () => {
    expect(guardSql("with p as (select id from properties) select count(*) from p").ok).toBe(true);
  });

  it("rejects multiple statements and comments", () => {
    expect(guardSql("select 1; select 2").ok).toBe(false);
    expect(guardSql("select 1 -- note").ok).toBe(false);
    expect(guardSql("select /* x */ 1").ok).toBe(false);
  });

  it("rejects each write, DDL, lock, and session keyword as a whole word", () => {
    const words = [
      "insert", "update", "delete", "merge", "truncate", "drop", "alter",
      "create", "grant", "revoke", "copy", "call", "do", "execute", "refresh",
      "lock", "set", "reset", "comment", "security", "vacuum", "analyze",
      "cluster", "reindex", "listen", "notify", "pg_sleep", "dblink",
    ];
    for (const w of words) {
      expect(guardSql(`select ${w} from properties`).ok, w).toBe(false);
    }
    expect(guardSql("select lo_import('/etc/passwd')").ok).toBe(false);
  });

  it("rejects a data-modifying CTE hidden behind SELECT", () => {
    expect(
      guardSql("with x as (delete from properties returning id) select * from x").ok
    ).toBe(false);
    expect(
      guardSql("with x as (insert into properties (name) values ('a') returning id) select 1").ok
    ).toBe(false);
  });

  it("rejects SELECT INTO and FOR UPDATE", () => {
    expect(guardSql("select * into evil from properties").ok).toBe(false);
    expect(guardSql("select * from properties for update").ok).toBe(false);
  });

  it("rejects empty and non-SELECT starts", () => {
    expect(guardSql("").ok).toBe(false);
    expect(guardSql("explain select 1").ok).toBe(false);
    expect(guardSql("vacuum").ok).toBe(false);
  });

  it("does not false-positive on column names containing keywords", () => {
    expect(
      guardSql("select updated_at, created_at, setting_name from leases order by updated_at desc").ok
    ).toBe(true);
    expect(guardSql("select name from properties where name ilike '%resetter%'").ok).toBe(true);
  });

  it("is conservative about keywords inside string literals (documented)", () => {
    expect(guardSql("select * from leases where name = 'update'").ok).toBe(false);
  });
});

// The 2026-11-14 hardening. Row level security trusts two session
// settings (the role and the JWT claims); these are the ways a SELECT
// could have changed them or run a second hidden statement.
describe("guardSql: a query cannot change who it runs as", () => {
  const refused = (sql: string) => expect(guardSql(sql).ok, sql).toBe(false);

  it("refuses set_config in every spelling", () => {
    refused("select set_config('role', 'service_role', true)");
    refused("select set_config ('role', 'service_role', true)");
    refused("select set_config\n('role', 'service_role', true)");
    refused("select SET_CONFIG('role', 'service_role', true)");
    refused("select pg_catalog.set_config('role', 'service_role', true)");
    refused(`select "set_config"('role', 'service_role', true)`);
    refused(`select U&"set\\005fconfig"('role', 'service_role', true)`);
    refused(
      `select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true)`
    );
  });

  it("refuses the helpers that run a second statement from text", () => {
    refused("select query_to_xml('select * from properties', false, false, '')");
    refused(
      "select case when set_config('role','service_role',true) is not null then query_to_xml('select * from public.properties', false, false, '') end"
    );
    refused("select query_to_xml('sel' || 'ect se' || 't_config(''role'',''service_role'',true)', false, false, '')");
    refused("select table_to_xml('properties', false, false, '')");
    refused("select * from ts_stat('select to_tsvector(name) from properties')");
    refused("select cursor_to_xml('c', 10, false, false, '')");
    refused("select database_to_xml(false, false, '')");
  });

  it("refuses reading settings, sign-in records, storage, and system tables", () => {
    refused("select current_setting('request.jwt.claims')");
    refused("select * from auth.users");
    refused("select * from storage.objects");
    refused("select * from vault.decrypted_secrets");
    refused("select * from net._http_response");
    refused("select * from pg_roles");
    refused("select * from pg_catalog.pg_proc");
    refused("select * from information_schema.tables");
    refused("select private.user_org_id()");
  });

  it("refuses any function that is not on the list, by name", () => {
    const r = guardSql("select st_area(boundary) from properties");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('"st_area("');
    refused("select assistant_query('select 1')");
    refused("select pg_sleep(10)");
    refused("select nextval('some_seq')");
    refused("select txid_current()");
  });

  it("refuses double quotes anywhere", () => {
    const r = guardSql('select name as "Property Name" from properties_geo');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Double quotes/);
  });

  it("does not mistake a longer word for a blocked schema", () => {
    expect(guardSql("select oauth.id from tenants oauth").ok).toBe(true);
  });
});

describe("guardSql: the queries the assistant actually writes still pass", () => {
  const accepted = (sql: string) => {
    const r = guardSql(sql);
    expect(r.ok, r.ok ? sql : `${sql} -> ${r.reason}`).toBe(true);
  };

  it("totals, rounding, grouping", () => {
    accepted(
      "select name, round(sum(acres)::numeric, 1) as acres from properties_geo group by name order by 2 desc limit 20"
    );
    accepted("select county, count(*) as parcels, sum(deeded_acres) from parcels_geo group by county");
    accepted(
      "select coalesce(terms->>'rate_per_acre', '0')::numeric(12,2) as rate from leases where lease_type = 'agricultural'"
    );
  });

  it("joins, subqueries, exists, in, case", () => {
    accepted(
      "select e.name, (select count(*) from properties_geo p where p.entity_id = e.id) as n from entities e where exists (select 1 from properties_geo p where p.entity_id = e.id)"
    );
    accepted(
      "select p.name, count(*) filter (where s.stand_type = 'planted_pine') as pine from properties_geo p join timber_stands_geo s on (s.property_id = p.id) group by p.name"
    );
    accepted(
      "select tax_year, sum(case when (line_type = 'real_property') then tax_due else 0 end) from tax_statement_lines where tax_year in (2024, 2025) group by tax_year"
    );
    accepted(
      "select name from properties_geo where id not in (select property_id from parcels_geo) and (county = 'Lawrence' or county = 'Morgan')"
    );
  });

  it("CTEs and window functions", () => {
    accepted(
      "with t as (select tax_year, sum(amount_due) as due from tax_statements group by tax_year) select tax_year, due, lag(due) over (order by tax_year) as prior from t"
    );
    accepted(
      "select name, acres, row_number() over (partition by property_id order by acres desc) as rn from fields_geo"
    );
  });

  it("dates and text", () => {
    accepted(
      "select to_char(received_date, 'YYYY-MM') as month, sum(amount) from payments where received_date >= date_trunc('year', now()) group by 1 order by 1"
    );
    accepted(
      "select extract(year from settlement_date) as y, sum(total_amount) from timber_settlements group by 1"
    );
    accepted("select lower(name), length(notes), left(notes, 80) from tenants where name ilike '%farm%'");
    accepted("select string_agg(name, ', ' order by name) from entities");
  });

  it("json and arrays", () => {
    accepted(
      "select a.year, d->>'crop' as crop, (d->>'acres')::numeric as acres from lease_year_assumptions a, jsonb_array_elements(a.data->'crops') as d"
    );
    accepted("select name, unnest(fsa_numbers) as fsa from properties_geo");
    accepted("select name, array_length(fsa_numbers, 1) from properties_geo where cardinality(fsa_numbers) > 0");
  });
});

describe("the allowlist matches the database function", () => {
  it("lists exactly the same names in the migration", () => {
    const start = MIGRATION.indexOf("-- ALLOWED_CALLS begin");
    const end = MIGRATION.indexOf("-- ALLOWED_CALLS end");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const inSql = [...MIGRATION.slice(start, end).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect([...inSql].sort()).toEqual([...ALLOWED_CALLS].sort());
    // No name twice in either copy.
    expect(new Set(inSql).size).toBe(inSql.length);
    expect(new Set(ALLOWED_CALLS).size).toBe(ALLOWED_CALLS.length);
  });

  it("blocks the same schemas in the migration", () => {
    const m = MIGRATION.match(/\\m\(([a-z_|]+)\)\\s\*\\\./);
    expect(m, "schema pattern not found in the migration").not.toBeNull();
    expect(m![1].split("|").sort()).toEqual([...BLOCKED_SCHEMAS].sort());
  });

  it("allows nothing that can run SQL from text or change a setting", () => {
    const never = [
      "set_config", "current_setting", "query_to_xml", "query_to_xmlschema",
      "query_to_xml_and_xmlschema", "table_to_xml", "cursor_to_xml", "schema_to_xml",
      "database_to_xml", "ts_stat", "ts_rewrite", "dblink", "dblink_exec",
      "assistant_query", "pg_sleep", "nextval", "setval", "lo_import", "lo_export",
    ];
    for (const name of never) expect(ALLOWED_CALLS, name).not.toContain(name);
  });
});
