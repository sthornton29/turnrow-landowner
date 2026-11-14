// Where to send someone after they sign in or follow an email link.
//
// The destination arrives in the URL (?next=/leases/123), so it can be
// written by anyone who sends a link. Only a path inside this app is
// accepted. Anything that could leave the site falls back to a safe
// default: a full address ("https://..."), a protocol-relative one
// ("//evil.example"), a backslash form browsers treat as a slash, or a
// value that would join onto the host name ("@evil.example",
// ".evil.example").

const MAX_LENGTH = 500;

export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (value === "" || value.length > MAX_LENGTH) return fallback;
  // Must be a path from the site root, and not the start of another host.
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Backslashes and control characters have no place in an app path, and
  // browsers normalize "/\" to "//".
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  // Never bounce back into the sign-in pages or the link handlers.
  const path = value.split(/[?#]/)[0];
  if (
    path === "/login" ||
    path === "/signup" ||
    path === "/forgot-password" ||
    path.startsWith("/auth/") ||
    path.startsWith("/api/")
  ) {
    return fallback;
  }
  return value;
}
