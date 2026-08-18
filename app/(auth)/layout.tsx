import Image from "next/image";

// Shared shell for login, signup, and onboarding: dark green brand
// background with the stacked white logo centered above the card.
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-pine-900 px-4 py-10">
      <Image
        src="/brand/turnrow_stacked_white.svg"
        alt="Turnrow"
        width={180}
        height={140}
        priority
        className="mb-8 h-auto w-40 sm:w-44"
      />
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg sm:p-8">
        {children}
      </div>
      <p className="mt-6 text-xs font-light uppercase tracking-[0.22em] text-white/60">
        Landowner
      </p>
    </div>
  );
}
