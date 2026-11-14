// SELECT-only validation for the data assistant's run_sql tool.
//
// This is the FIRST of two gates. The database function assistant_query()
// (supabase/migrations/0052_assistant_query_allowlist.sql) re-validates
// with the same rules and additionally runs the query with
// transaction_read_only on, a statement timeout, and a 200 row cap, as
// the CALLING USER (security invoker) so RLS isolation applies to
// whatever SQL the model writes. Rejecting SQL here saves a round trip
// and gives the model a clear error to correct, nothing more: the
// database copy is the one that counts, because any signed-in account
// can call that function directly without going through this file.
//
// WHY AN ALLOWLIST OF FUNCTIONS (2026-11-14). Row level security decides
// what a query may read from the caller's identity (the request's JWT
// claims) and role. Both are session settings, and a plain SELECT can
// change them by calling set_config(), or run a second, hidden statement
// through helpers such as query_to_xml(). The old rule (a list of
// forbidden WORDS) could not close that: "set_config" is not the word
// "set", and a forbidden name can be assembled from pieces inside a
// string. So the rule is now the other way round: a query may call ONLY
// the functions named below. Anything else followed by "(" is refused,
// whatever it is called. Double-quoted names are refused too, since a
// quoted name is the one way to spell a function the scan would not see.
//
// Deliberately conservative: forbidden words and unknown "name(" are
// rejected even inside string literals (a query filtering notes on
// '%update%' or '%shop (old)%' must be rephrased). False positives are
// cheap; a query that rewrites its own identity is not. Whole-word
// matching means column names like updated_at, created_at, or
// setting_name pass.

const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|execute|refresh|lock|set|reset|comment|security|vacuum|analyze|cluster|reindex|listen|notify|into|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|dblink)\b/i;

const LO_FUNCTIONS = /\blo_[a-z_]*/i;

const LOCK_CLAUSE = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i;

// Schemas the assistant has no business reading: sign-in records, file
// storage, secrets, the app's private helpers, and the system catalogs.
// The app's own data lives in the default (public) schema.
export const BLOCKED_SCHEMAS = [
  "auth",
  "storage",
  "vault",
  "pgsodium",
  "supabase_functions",
  "extensions",
  "graphql",
  "graphql_public",
  "realtime",
  "cron",
  "private",
  "pg_catalog",
  "information_schema",
  "pg_temp",
  "pg_toast",
] as const;

const BLOCKED_SCHEMA = new RegExp(`\\b(${BLOCKED_SCHEMAS.join("|")})\\s*\\.`, "i");
const NET_SCHEMA = /\bnet\s*\.\s*_?http/i;
// System catalog tables and functions all begin pg_ and need no schema
// prefix, so the prefix check above does not cover them.
const SYSTEM_NAME = /\bpg_/i;

// EVERY word that may stand directly before "(". Keep this list and the
// one in the migration identical: assistantSql.test.ts compares them.
// Everything here is either SQL syntax or a pure function of its
// arguments; nothing on it can run SQL from text or change a setting.
export const ALLOWED_CALLS: readonly string[] = [
  // SQL syntax that takes a parenthesis
  "select", "from", "where", "and", "or", "not", "in", "exists", "any", "all", "some",
  "as", "on", "using", "join", "lateral", "values", "over", "filter", "by",
  "when", "then", "else", "case", "union", "intersect", "except", "distinct",
  "having", "limit", "offset", "between", "like", "ilike", "to",
  "group", "sets", "rollup", "cube", "materialized", "array", "row",
  // type names written with a length or precision
  "numeric", "decimal", "varchar", "char", "character", "varying",
  "timestamp", "timestamptz", "time", "float",
  // built-in forms with their own syntax
  "cast", "extract", "position", "substring", "trim", "overlay",
  "coalesce", "nullif", "greatest", "least",
  // totals
  "count", "sum", "avg", "min", "max", "string_agg", "array_agg",
  "json_agg", "jsonb_agg", "json_object_agg", "jsonb_object_agg",
  "bool_and", "bool_or", "every", "stddev", "variance",
  "percentile_cont", "percentile_disc", "mode",
  // ranking
  "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile",
  "lag", "lead", "first_value", "last_value", "nth_value",
  // numbers
  "abs", "round", "trunc", "ceil", "ceiling", "floor", "sign", "sqrt",
  "power", "exp", "ln", "log", "mod", "div",
  // text
  "lower", "upper", "initcap", "length", "char_length", "btrim", "ltrim", "rtrim",
  "lpad", "rpad", "left", "right", "substr", "strpos", "replace", "translate",
  "split_part", "concat", "concat_ws", "repeat", "reverse", "starts_with", "format",
  "regexp_replace", "regexp_match", "regexp_matches", "regexp_split_to_array",
  "regexp_split_to_table", "string_to_array", "array_to_string",
  "to_char", "to_number", "to_date", "to_timestamp",
  // dates
  "now", "date_trunc", "date_part", "age", "make_date", "date", "isfinite",
  // lists
  "unnest", "array_length", "cardinality", "array_position", "array_remove",
  "array_append", "array_cat", "generate_series",
  // json
  "jsonb_array_elements", "jsonb_array_elements_text", "jsonb_array_length",
  "jsonb_each", "jsonb_each_text", "jsonb_object_keys", "jsonb_extract_path",
  "jsonb_extract_path_text", "jsonb_typeof", "jsonb_build_object", "jsonb_build_array",
  "jsonb_strip_nulls", "to_jsonb", "to_json", "json_build_object", "json_build_array",
  "json_array_elements", "json_array_elements_text", "json_array_length",
  "json_each", "json_each_text", "json_object_keys", "json_extract_path",
  "json_extract_path_text", "json_typeof", "row_to_json",
];

const ALLOWED = new Set(ALLOWED_CALLS);

// A name, optional spaces, an opening parenthesis: how every function
// call is written. Scanned over the whole text, quoted parts included.
const CALL = /([a-z_][a-z0-9_$]*)\s*\(/g;

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
  if (sql.includes('"')) {
    return {
      ok: false,
      reason: 'Double quotes are not allowed. Write names plainly (as total_acres, not as "Total Acres").',
    };
  }
  if (BLOCKED_SCHEMA.test(sql) || NET_SCHEMA.test(sql) || SYSTEM_NAME.test(sql)) {
    return {
      ok: false,
      reason: "Only this organization's own tables and views can be read (no schema prefixes, no system tables).",
    };
  }
  const lowered = sql.toLowerCase();
  for (const match of lowered.matchAll(CALL)) {
    const name = match[1];
    if (!ALLOWED.has(name)) {
      return {
        ok: false,
        reason:
          `"${name}(" is not an allowed function. Use plain SQL with the common functions ` +
          "(count, sum, avg, min, max, round, coalesce, lower, to_char, date_trunc, extract, string_agg, the json and jsonb readers). " +
          'Any word directly before "(" counts as a function, so do not write column-list aliases like "as t(x)", ' +
          'and avoid "word (" inside quoted text.',
      };
    }
  }
  return { ok: true, sql };
}
