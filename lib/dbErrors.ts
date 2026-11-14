// Turns a database or network error into a sentence a family member can
// act on. Raw Postgres text ("new row violates row-level security policy
// for table ...") must never reach the screen.
//
// Use it wherever a Supabase write can fail:
//   const { error } = await supabase.from("leases").update(...);
//   if (error) { setError(friendlyDbError(error, "Could not save the lease.")); return; }

type ErrorLike = { code?: string | null; message?: string | null } | Error | string | null | undefined;

export const NO_ACCESS_MESSAGE =
  "You do not have access to do that. Ask an admin on your account to make this change or to give you access.";

export function isAccessError(error: ErrorLike): boolean {
  if (!error) return false;
  const code = typeof error === "object" && "code" in error ? error.code ?? "" : "";
  const message = (typeof error === "string" ? error : error.message ?? "").toLowerCase();
  return code === "42501" || message.includes("row-level security") || message.includes("permission denied");
}

export function friendlyDbError(error: ErrorLike, fallback = "That did not save. Please try again."): string {
  if (!error) return fallback;
  const code = typeof error === "object" && "code" in error ? error.code ?? "" : "";
  const message = typeof error === "string" ? error : error.message ?? "";
  const lower = message.toLowerCase();

  if (isAccessError(error)) return NO_ACCESS_MESSAGE;
  // No rows came back for a single-row read or write: the record is gone
  // or outside what this person can see.
  if (code === "PGRST116") {
    return "That record was not found. It may have been removed, or you may not have access to it.";
  }
  if (code === "23505" || lower.includes("duplicate key")) {
    return "That already exists, so it was not added again.";
  }
  if (code === "23503" || lower.includes("foreign key")) {
    return "This is still linked to other records, so it cannot be removed or changed yet.";
  }
  if (code === "23502" || lower.includes("null value in column")) {
    return "Something required is missing. Fill in the empty fields and try again.";
  }
  if (code === "22008" || code === "22007" || lower.includes("date/time field value out of range")) {
    return "One of the dates is not a real calendar date. Check the dates and try again.";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed")
  ) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return fallback;
}
