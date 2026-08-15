// Formatting conventions used everywhere in the app:
// numbers get commas, acres show 1 decimal place, dollars show 2 decimals.

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
