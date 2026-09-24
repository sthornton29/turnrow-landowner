// The ONE navigation model, shared by the desktop header (grouped
// dropdowns) and the phone tab bar (five tabs plus a "More" sheet that
// lists every section). Fourteen flat pills crowded laptop widths and
// left nine sections unreachable on a phone; grouping keeps every page
// one or two taps away everywhere. lib/help.test.ts reads the href
// literals in this file to check that every section has a help topic.

export interface NavItem {
  href: string;
  label: string;
  // One plain sentence for the phone "More" sheet and dropdown hints.
  hint: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_ITEMS = {
  map: { href: "/map", label: "Map", hint: "Your land from above, with everything drawn on it." },
  home: { href: "/dashboard", label: "Home", hint: "What needs attention and the numbers at a glance." },
  properties: { href: "/properties", label: "Properties", hint: "Each tract, its parcels, fields, and who holds it." },
  timber: { href: "/timber", label: "Timber", hint: "Stands, species, and timber sales." },
  assets: { href: "/assets", label: "Assets", hint: "Wells, pivots, bins, buildings, and pipe." },
  maintenance: { href: "/maintenance", label: "Maintenance", hint: "Washes, sinkholes, and other problems to fix." },
  leases: { href: "/leases", label: "Leases", hint: "Tenants, lease terms, and payments owed." },
  income: { href: "/income", label: "Income", hint: "Expected versus received, by year and entity." },
  taxes: { href: "/taxes", label: "Property Taxes", hint: "Statements, what is paid, and what is missing." },
  gov: { href: "/gov-payments", label: "Government Payments", hint: "ARC and PLC base acres and your share." },
  documents: { href: "/documents", label: "Documents", hint: "Deeds, surveys, leases, and statements, searchable." },
  farm: { href: "/farm-activity", label: "Farm Data", hint: "What your tenants planted and harvested." },
  import: { href: "/import", label: "Import", hint: "County records or boundary files onto the map." },
  ask: { href: "/ask", label: "Ask", hint: "Questions about your own land, answered from your records." },
} as const satisfies Record<string, NavItem>;

// Desktop header, left to right. Single items render as pills; groups as
// a pill that opens a small menu.
export const DESKTOP_NAV: Array<NavItem | NavGroup> = [
  NAV_ITEMS.map,
  NAV_ITEMS.home,
  {
    label: "Land",
    items: [NAV_ITEMS.properties, NAV_ITEMS.timber, NAV_ITEMS.assets, NAV_ITEMS.maintenance],
  },
  {
    label: "Financial",
    items: [NAV_ITEMS.leases, NAV_ITEMS.income, NAV_ITEMS.taxes, NAV_ITEMS.gov],
  },
  {
    label: "Records",
    items: [NAV_ITEMS.documents, NAV_ITEMS.farm, NAV_ITEMS.import],
  },
  NAV_ITEMS.ask,
];

// Phone "More" sheet: every section, grouped the same way.
export const MOBILE_GROUPS: NavGroup[] = [
  { label: "Land", items: [NAV_ITEMS.map, NAV_ITEMS.properties, NAV_ITEMS.timber, NAV_ITEMS.assets, NAV_ITEMS.maintenance] },
  { label: "Financial", items: [NAV_ITEMS.leases, NAV_ITEMS.income, NAV_ITEMS.taxes, NAV_ITEMS.gov] },
  { label: "Records", items: [NAV_ITEMS.documents, NAV_ITEMS.farm, NAV_ITEMS.import] },
  { label: "Help", items: [NAV_ITEMS.ask] },
];

export function isGroup(entry: NavItem | NavGroup): entry is NavGroup {
  return "items" in entry;
}

// Entities is a tab of the Properties section; Tenants and Timber sales
// are tabs of Leases; the tax upload lives under Property Taxes.
const ALIASES: Record<string, string[]> = {
  "/properties": ["/entities", "/parcels", "/fields", "/pastures", "/wetlands", "/cemeteries", "/easements", "/roads"],
  "/leases": ["/tenants", "/timber-sales"],
  "/timber": ["/timber-scan"],
  "/farm-activity": ["/farms"],
};

export function isActive(pathname: string, href: string): boolean {
  const hit = (base: string) => pathname === base || pathname.startsWith(base + "/");
  if (hit(href)) return true;
  return (ALIASES[href] ?? []).some(hit);
}
