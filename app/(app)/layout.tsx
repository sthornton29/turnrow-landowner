import AppHeader from "@/components/layout/AppHeader";
import MobileNav from "@/components/layout/MobileNav";
import { requireOrg } from "@/lib/auth";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Redirects to /login or /onboarding when the visitor is not fully set up.
  const { profile } = await requireOrg();

  return (
    <div className="flex min-h-dvh flex-col bg-gray-50">
      <AppHeader isPlatformAdmin={profile.is_platform_admin ?? false} />
      {/* pb-16 leaves room for the mobile bottom tab bar */}
      <main className="flex-1 pb-16 md:pb-0">{children}</main>
      <MobileNav />
    </div>
  );
}
