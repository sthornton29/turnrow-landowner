import Link from "next/link";

const TABS = [
  { href: "/leases", label: "Leases" },
  { href: "/tenants", label: "Tenants" },
  { href: "/timber-sales", label: "Timber sales" },
];

// Shared tab bar for the Leases section (leases, tenants, timber sales).
export default function SectionTabs({ active }: { active: string }) {
  return (
    <div className="flex gap-1 border-b border-gray-200">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium " +
            (active === tab.href
              ? "border-kelly-500 text-pine-900"
              : "border-transparent text-gray-500 hover:text-gray-800")
          }
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
