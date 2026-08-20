// Pure assembly of the support email (/api/support-contact sends it via
// Resend). Kept pure so the payload, every context field and the escalated
// chat transcript, is unit tested. Context is gathered SERVER SIDE from the
// session, never trusted from the request body.

export interface SupportContext {
  userEmail: string;
  orgName: string;
  role: string;
  route: string;
  build: string;
  browser: string;
}

export interface SupportInput {
  subject: string;
  message: string;
  transcript?: string;
}

export function buildSupportEmail(
  input: SupportInput,
  ctx: SupportContext
): { subject: string; text: string } {
  const subject = `[Turnrow Landowner support] ${input.subject || "Support request"} (${ctx.orgName})`;
  const lines = [
    input.message.trim(),
    "",
    "--------------------------------",
    `From:    ${ctx.userEmail} (${ctx.role})`,
    `Org:     ${ctx.orgName}`,
    `Page:    ${ctx.route}`,
    `Build:   ${ctx.build}`,
    `Browser: ${ctx.browser}`,
  ];
  if (input.transcript && input.transcript.trim()) {
    lines.push("", "---- Help chat conversation ----", input.transcript.trim());
  }
  return { subject, text: lines.join("\n") };
}

// Size guard for an optional screenshot sent as a base64 data URL.
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

export function parseScreenshotDataUrl(
  dataUrl: string | undefined | null
): { contentType: string; base64: string } | null {
  if (!dataUrl) return null;
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  return { contentType: m[1], base64: m[2] };
}

export function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
