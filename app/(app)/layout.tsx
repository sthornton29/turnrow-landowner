import AppHeader from "@/components/layout/AppHeader";
import MobileNav from "@/components/layout/MobileNav";
import { requireOrg } from "@/lib/auth";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Redirects to /login or /onboarding when the visitor is not fully set up.
  await requireOrg();

  return (
    <div className="flex min-h-dvh flex-col bg-gray-50">
      <AppHeader />
      {/* Leaves room for the mobile bottom tab bar (0 on desktop) */}
      <main className="flex-1 pb-(--nav-h)">{children}</main>
      <MobileNav />
    </div>
  );
}
