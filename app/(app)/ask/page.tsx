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
  return (
    <div
      className="mx-auto flex max-w-3xl flex-col p-4 md:p-6"
      style={{ height: "calc(100dvh - 8.5rem)" }}
    >
      <h1 className="text-2xl font-semibold text-gray-900">Ask about your land</h1>
      <p className="mb-3 text-sm text-gray-500">
        Questions about your own acres, leases, taxes, timber, easements, and
        payments, answered from your records only. For how the app works, use
        the Help Center.
      </p>
      <div className="min-h-0 flex-1 rounded-xl border border-gray-200 bg-white p-4">
        <AssistantChat autoFocus initialQuestion={q?.trim() || null} />
      </div>
    </div>
  );
}
