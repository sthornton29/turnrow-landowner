import { describe, expect, it } from "vitest";
import {
  formatAcres,
  formatDate,
  formatDateTime,
  formatDollars,
  formatNumber,
  plural,
  todayISO,
} from "./format";

describe("number formatting", () => {
  it("acres: commas and one decimal", () => {
    expect(formatAcres(1234.56)).toBe("1,234.6");
    expect(formatAcres(null)).toBe("0.0");
  });
  it("dollars: commas and two decimals", () => {
    expect(formatDollars(283887.53)).toBe("$283,887.53");
    expect(formatDollars(undefined)).toBe("$0.00");
  });
  it("numbers: commas", () => {
    expect(formatNumber(12345)).toBe("12,345");
  });
});

describe("plural", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "parcel")).toBe("1 parcel");
    expect(plural(0, "parcel")).toBe("0 parcels");
    expect(plural(83, "parcel")).toBe("83 parcels");
  });
  it("takes an irregular plural", () => {
    expect(plural(1, "property", "properties")).toBe("1 property");
    expect(plural(23, "property", "properties")).toBe("23 properties");
  });
  it("puts commas in large counts and treats null as zero", () => {
    expect(plural(1204, "record")).toBe("1,204 records");
    expect(plural(null, "record")).toBe("0 records");
  });
});

describe("todayISO", () => {
  it("is the Central date, not the UTC date, in the evening", () => {
    // 6:30 pm Central on Dec 31, 2026 is already Jan 1 in UTC.
    expect(todayISO(new Date("2027-01-01T00:30:00Z"))).toBe("2026-12-31");
  });
  it("matches UTC during the Central daytime", () => {
    expect(todayISO(new Date("2026-11-14T18:00:00Z"))).toBe("2026-11-14");
  });
  it("handles daylight time (UTC minus 5)", () => {
    // 11:30 pm Central daylight time on Jul 3 is 04:30 UTC on Jul 4.
    expect(todayISO(new Date("2026-07-04T04:30:00Z"))).toBe("2026-07-03");
  });
});

describe("formatDate", () => {
  it("shows a date-only value as that calendar day (no time zone shift)", () => {
    expect(formatDate("2026-10-01")).toBe("Oct 1, 2026");
    expect(formatDate("2027-01-01")).toBe("Jan 1, 2027");
    expect(formatDate("2026-12-31")).toBe("Dec 31, 2026");
  });
  it("shows a timestamp as its Central day", () => {
    // 03:00 UTC on Nov 15 is 9 pm Central on Nov 14.
    expect(formatDate("2026-11-15T03:00:00Z")).toBe("Nov 14, 2026");
    expect(formatDate(new Date("2026-11-15T03:00:00Z"))).toBe("Nov 14, 2026");
  });
  it("returns an empty string instead of Invalid Date", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("shows Central time", () => {
    expect(formatDateTime("2026-11-14T12:02:03Z")).toBe("Nov 14, 2026, 6:02 AM");
  });
  it("returns an empty string for unreadable input", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("nope")).toBe("");
  });
});
