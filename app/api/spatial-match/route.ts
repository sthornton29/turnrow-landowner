import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { spatialEvidenceFor } from "@/lib/spatialEvidence";

export const maxDuration = 90;

// Re-run the intake's spatial tier on an extraction the client already
// holds (the confirm screen's Retry, or a document page Rescan of the
// description): no model call, just the reference resolution and the
// overlap under the caller's RLS. Body: { extraction }.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let body: { extraction?: Record<string, unknown> };
  try {
    body = (await request.json()) as { extraction?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const extraction = body.extraction && typeof body.extraction === "object" ? body.extraction : {};
  const spatial = await spatialEvidenceFor(supabase, extraction);
  return NextResponse.json({ spatial });
}
