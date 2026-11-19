import { requireOrg } from "@/lib/auth";
import AssistantChat from "@/components/assistant/AssistantChat";

export const metadata = { title: "Ask about your land" };

// The data assistant, full page. What it can see is enforced by the
// user's own RLS, not by this page. Kept separate from the Help Center's
// chat: this one knows your records, that one knows the app.
export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireOrg();
  const { q } = await searchParams;
  // Pinned between the header and the tab bar (not sized from the screen
  // height, which Chrome on iPhone reports wrongly) so the question box
  // always sits just above the tabs.
  return (
    <div className="fixed inset-x-0 top-(--header-h) bottom-(--nav-h) flex">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-col p-3 md:p-6">
        <h1 className="text-xl font-semibold text-gray-900 md:text-2xl">Ask about your land</h1>
        <p className="mb-3 text-sm text-gray-500">
          Questions about your own acres, leases, taxes, timber, easements, and
          payments, answered from your records only.
          <span className="hidden md:inline"> For how the app works, use the Help Center.</span>
        </p>
        <div className="min-h-0 flex-1 rounded-xl border border-gray-200 bg-white p-3 md:p-4">
          <AssistantChat autoFocus initialQuestion={q?.trim() || null} />
        </div>
      </div>
    </div>
  );
}
