import Link from "next/link";

const TABS = [
  { href: "/properties", label: "Properties" },
  { href: "/entities", label: "Entities" },
];

// Shared tab bar for the Properties section (properties, entities),
// same pattern as the Leases section tabs.
export default function PropertySectionTabs({ active }: { active: string }) {
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
