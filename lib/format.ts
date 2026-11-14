// Formatting conventions used everywhere in the app:
// numbers get commas, acres show 1 decimal place, dollars show 2 decimals,
// and dates read "Dec 10, 2026".

export function formatAcres(acres: number | null | undefined): string {
  if (acres === null || acres === undefined) return "0.0";
  return Number(acres).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "0";
  return Number(n).toLocaleString("en-US");
}

export function formatDollars(n: number | null | undefined): string {
  if (n === null || n === undefined) return "$0.00";
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// "1 parcel", "3 parcels", "1,204 acres". Pass the plural when adding
// an s is not enough ("property", "properties").
export function plural(n: number | null | undefined, singular: string, pluralForm?: string): string {
  const count = Number(n ?? 0);
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm ?? singular + "s"}`;
}

// ---------------------------------------------------------------- dates
//
// The land and the people reading these pages are in the Central time
// zone, while the server runs in UTC. Every "what day is it" and every
// timestamp shown on screen goes through this one zone so the server and
// the browser always agree (no day flipping at 6 pm, no mismatched first
// paint).
export const APP_TIME_ZONE = "America/Chicago";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Today's date as YYYY-MM-DD in the app's time zone. Use this for date
// input defaults and for "is this past due" checks; never
// new Date().toISOString().slice(0, 10), which is the UTC date and reads
// as tomorrow every evening.
export function todayISO(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// "Dec 10, 2026". A date-only value (YYYY-MM-DD, how Postgres date
// columns arrive) is shown as that calendar day and is never shifted by
// a time zone; a full timestamp is shown as its day in the app's zone.
// Anything unreadable comes back as an empty string so "Invalid Date"
// never reaches the screen.
export function formatDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value);
    if (m) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// "Dec 10, 2026, 6:02 AM" in the app's time zone, for "last synced" style
// timestamps.
export function formatDateTime(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
