"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";

// Shown inside the app (header and tabs still in place) when a page
// fails. Without this, one failed page replaced the whole screen with a
// bare error, and from a home-screen icon there is no address bar or
// reload button to get out of it.
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold text-gray-900">This page did not load</h1>
      <p className="mt-2 text-sm text-gray-600">
        Something went wrong while loading it. Your records are safe. Check
        your connection and try again.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-lg bg-kelly-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-kelly-600"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Go to Home
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-4 text-xs text-gray-400">
          If this keeps happening, use Contact support under the ? button and
          mention reference {error.digest}.
        </p>
      ) : null}
    </div>
  );
}
