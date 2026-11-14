import Link from "next/link";

// Shown inside the app (header and tabs still in place) when a page
// calls notFound(): the record was deleted, the link is old, or the
// record belongs to land this person has not been given access to. Row
// level security makes those last two look the same on purpose, so the
// message covers both.
export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold text-gray-900">We could not find that</h1>
      <p className="mt-2 text-sm text-gray-600">
        This record may have been removed, the link may be out of date, or it
        may belong to land you have not been given access to. If you think you
        should see it, ask an admin on your account.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link
          href="/map"
          className="rounded-lg bg-kelly-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-kelly-600"
        >
          Open the map
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Go to Home
        </Link>
      </div>
    </div>
  );
}
