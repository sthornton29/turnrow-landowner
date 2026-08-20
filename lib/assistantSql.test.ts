import { describe, expect, it } from "vitest";
import { guardSql } from "./assistantSql";

// Mirrors the rules in supabase/migrations/0022_assistant.sql. The DB
// function is the enforcing copy; this guard only saves a round trip.
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
