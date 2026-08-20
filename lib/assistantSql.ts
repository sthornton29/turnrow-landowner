// SELECT-only validation for the data assistant's run_sql tool.
//
// This is the FIRST of two gates. The database function assistant_query()
// (supabase/migrations/0022_assistant.sql) re-validates with the same
// rules and additionally runs the query with transaction_read_only on, a
// 5 second statement timeout, and a 200 row cap, as the CALLING USER
// (security invoker) so RLS isolation applies to whatever SQL the model
// writes. Tenant isolation is Postgres RLS, never prompt language or this
// validator: rejecting SQL here saves a round trip and gives the model a
// clear error to correct, nothing more.
//
// Deliberately conservative: whole-word write keywords are rejected even
// inside string literals (a query filtering notes on '%update%' must be
// rephrased). False positives are cheap; a data-modifying CTE is not.
// Whole-word matching means column names like updated_at, created_at, or
// setting_name pass.

const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|execute|refresh|lock|set|reset|comment|security|vacuum|analyze|cluster|reindex|listen|notify|into|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|dblink)\b/i;

const LO_FUNCTIONS = /\blo_[a-z_]*/i;

const LOCK_CLAUSE = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i;

export type SqlGuard = { ok: true; sql: string } | { ok: false; reason: string };

export function guardSql(raw: string): SqlGuard {
  let sql = (raw ?? "").trim();
  if (sql === "") return { ok: false, reason: "Empty query." };
  // A single trailing semicolon is the model being tidy: strip it.
  sql = sql.replace(/;\s*$/, "");
  if (sql.includes(";")) {
    return { ok: false, reason: "One SELECT statement only; no semicolons." };
  }
  if (sql.includes("--") || sql.includes("/*")) {
    return { ok: false, reason: "SQL comments are not allowed." };
  }
  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, reason: "Only SELECT (or WITH ... SELECT) queries are allowed." };
  }
  const kw = sql.match(WRITE_KEYWORDS);
  if (kw) {
    return {
      ok: false,
      reason: `Read-only: "${kw[1].toLowerCase()}" is not allowed (rephrase without it, including inside quoted strings).`,
    };
  }
  if (LO_FUNCTIONS.test(sql)) {
    return { ok: false, reason: "Read-only: large object functions are not allowed." };
  }
  if (LOCK_CLAUSE.test(sql)) {
    return { ok: false, reason: "Read-only: row-locking clauses are not allowed." };
  }
  return { ok: true, sql };
}
