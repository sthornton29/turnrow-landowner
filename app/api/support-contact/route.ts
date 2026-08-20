// POST /api/support-contact: the Contact support form. Assembles the email
// (lib/supportRequest.ts, pure and tested) with the caller's context
// gathered SERVER SIDE from their session (email, organization, role,
// never trusted from the body), the page they were on, and the build, then
// sends it to the support address via Resend with Reply-To set to the user
// so support answers straight from the inbox. Optional screenshot rides
// along as an attachment. Clear 503 when Resend is not configured;
// per-user hourly limit.
//
// Env: RESEND_API_KEY, SUPPORT_EMAIL (to), SUPPORT_FROM (optional,
// defaults to a Turnrow sender that must be verified in Resend).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_SCREENSHOT_BYTES,
  base64Bytes,
  buildSupportEmail,
  parseScreenshotDataUrl,
} from "@/lib/supportRequest";
import { checkRateLimit, rateLimited429 } from "@/lib/rateLimit";

const MAX_MESSAGE = 8000;
const MAX_TRANSCRIPT = 20000;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const orgId = (profile?.organization_id as string | null) ?? null;

  const limit = await checkRateLimit(supabase, {
    userId: user.id,
    orgId,
    kind: "support_contact",
    limitPerHour: 5,
  });
  if (!limit.allowed) return rateLimited429("support_contact");

  const key = process.env.RESEND_API_KEY;
  const to = process.env.SUPPORT_EMAIL;
  if (!key || !to) {
    return NextResponse.json(
      {
        error:
          "Support email is not set up on this server yet (RESEND_API_KEY and SUPPORT_EMAIL). Please email support directly.",
      },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    subject?: string;
    message?: string;
    pathname?: string;
    transcript?: string;
    screenshot?: string;
    screenshotName?: string;
  } | null;
  const message = (body?.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Tell us what you need help with." }, { status: 400 });
  }

  // Context comes from the SESSION, not the request body.
  let orgName = "unknown";
  if (orgId) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    orgName = (org?.name as string | undefined) ?? "unknown";
  }
  const role = (profile?.role as string | undefined) ?? "member";
  const build = (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7);

  const email = buildSupportEmail(
    {
      subject: (body?.subject ?? "").slice(0, 200),
      message: message.slice(0, MAX_MESSAGE),
      transcript: body?.transcript?.slice(0, MAX_TRANSCRIPT),
    },
    {
      userEmail: user.email,
      orgName,
      role,
      route: (body?.pathname ?? "/").slice(0, 200),
      build,
      browser: (req.headers.get("user-agent") ?? "unknown").slice(0, 300),
    }
  );

  const attachments: Array<{ filename: string; content: string }> = [];
  if (body?.screenshot) {
    const shot = parseScreenshotDataUrl(body.screenshot);
    if (!shot) {
      return NextResponse.json({ error: "Screenshots must be an image." }, { status: 400 });
    }
    if (base64Bytes(shot.base64) > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json(
        { error: "That image is too large. Keep it under 2 MB." },
        { status: 400 }
      );
    }
    const ext = shot.contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const name = (body.screenshotName ?? `screenshot.${ext}`)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 100);
    attachments.push({ filename: name, content: shot.base64 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.SUPPORT_FROM ?? "Turnrow Landowner <support@turnrow.farm>",
      to: [to],
      reply_to: user.email,
      subject: email.subject,
      text: email.text,
      ...(attachments.length > 0 ? { attachments } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`support-contact send failed (${res.status}): ${detail.slice(0, 500)}`);
    return NextResponse.json(
      { error: "Could not send right now. Please try again in a few minutes." },
      { status: 502 }
    );
  }
  console.log(
    `support-contact sent: ${user.email} (${orgName}) "${email.subject}"${attachments.length ? " +screenshot" : ""}${body?.transcript ? " +transcript" : ""}`
  );
  return NextResponse.json({ ok: true });
}
