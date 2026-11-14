// Shown the instant someone taps a link, while the next page gathers its
// records. Several pages run a dozen or more lookups before they can
// draw; without this a tap looked like nothing had happened.
export default function AppLoading() {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="animate-pulse space-y-4" aria-hidden="true">
        <div className="h-6 w-40 rounded bg-gray-200" />
        <div className="h-4 w-64 max-w-full rounded bg-gray-200" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="h-20 rounded-xl bg-gray-200" />
          <div className="h-20 rounded-xl bg-gray-200" />
          <div className="h-20 rounded-xl bg-gray-200" />
          <div className="h-20 rounded-xl bg-gray-200" />
        </div>
        <div className="h-40 rounded-xl bg-gray-200" />
        <div className="h-40 rounded-xl bg-gray-200" />
      </div>
    </div>
  );
}
