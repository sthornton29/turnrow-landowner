import Link from "next/link";

// An address that does not match any page. Outside the app shell (the
// shell needs a signed-in member), so it carries its own way back.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-pine-900 px-4 py-10">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-lg sm:p-8">
        <h1 className="text-xl font-semibold text-pine-900">Page not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          That address does not go anywhere. It may have been mistyped, or the
          link may be out of date.
        </p>
        <Link
          href="/map"
          className="mt-5 block w-full rounded-lg bg-kelly-500 px-4 py-2.5 font-semibold text-white transition hover:bg-kelly-600"
        >
          Open the map
        </Link>
      </div>
      <p className="mt-6 text-xs font-light uppercase tracking-[0.22em] text-white/60">
        Turnrow Landowner
      </p>
    </div>
  );
}
