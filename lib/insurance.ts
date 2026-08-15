// Shared insurance badge logic for tenants.

export interface InsuranceInfo {
  insurance_on_file: boolean;
  insurance_expires: string | null;
}

export function insuranceBadge(t: InsuranceInfo): {
  label: string;
  className: string;
} {
  if (!t.insurance_on_file) {
    return { label: "No insurance on file", className: "bg-gray-100 text-gray-600" };
  }
  if (t.insurance_expires) {
    const expires = new Date(t.insurance_expires + "T00:00:00");
    const now = new Date();
    if (expires < now) {
      return {
        label: `Insurance expired ${t.insurance_expires}`,
        className: "bg-red-50 text-red-700",
      };
    }
    const soon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    if (expires < soon) {
      return {
        label: `Insurance expires ${t.insurance_expires}`,
        className: "bg-amber-50 text-amber-800",
      };
    }
    return {
      label: `Insured through ${t.insurance_expires}`,
      className: "bg-kelly-50 text-pine-900",
    };
  }
  return { label: "Insurance on file", className: "bg-kelly-50 text-pine-900" };
}
