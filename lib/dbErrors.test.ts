import { describe, expect, it } from "vitest";
import { friendlyDbError, isAccessError, NO_ACCESS_MESSAGE } from "./dbErrors";

describe("friendlyDbError", () => {
  it("never passes row-level security text through", () => {
    const rls = {
      code: "42501",
      message: 'new row violates row-level security policy for table "properties"',
    };
    expect(friendlyDbError(rls)).toBe(NO_ACCESS_MESSAGE);
    expect(friendlyDbError(rls)).not.toMatch(/row-level|policy|table/i);
    expect(isAccessError(rls)).toBe(true);
  });
  it("recognizes an access error by message when the code is missing", () => {
    expect(
      friendlyDbError({ message: "new row violates row-level security policy" })
    ).toBe(NO_ACCESS_MESSAGE);
    expect(friendlyDbError("permission denied for table leases")).toBe(NO_ACCESS_MESSAGE);
  });
  it("explains duplicates, links, and missing values in plain words", () => {
    expect(friendlyDbError({ code: "23505", message: "duplicate key value" })).toMatch(/already exists/);
    expect(friendlyDbError({ code: "23503", message: "violates foreign key constraint" })).toMatch(/still linked/);
    expect(friendlyDbError({ code: "23502", message: 'null value in column "acres"' })).toMatch(/required is missing/);
    expect(friendlyDbError({ code: "PGRST116", message: "0 rows" })).toMatch(/not found/);
  });
  it("names an impossible date", () => {
    expect(
      friendlyDbError({ code: "22008", message: 'date/time field value out of range: "2027-02-30"' })
    ).toMatch(/not a real calendar date/);
  });
  it("explains a dropped connection", () => {
    expect(friendlyDbError(new TypeError("Failed to fetch"))).toMatch(/connection/);
    expect(friendlyDbError(new Error("Load failed"))).toMatch(/connection/);
  });
  it("falls back to the caller's sentence, never the raw message", () => {
    expect(friendlyDbError({ code: "XX000", message: "some internal detail" }, "Could not save the lease.")).toBe(
      "Could not save the lease."
    );
    expect(friendlyDbError(null, "Could not save.")).toBe("Could not save.");
  });
  it("does not flag ordinary errors as access errors", () => {
    expect(isAccessError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isAccessError(null)).toBe(false);
  });
});
