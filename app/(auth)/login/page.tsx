import type { Metadata } from "next";
import { safeNextPath } from "@/lib/safeNext";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

// The page reads the URL on the server (a notice from an email link, and
// where to go after signing in) and hands both to the form.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  return <LoginForm notice={one(params.notice)} next={safeNextPath(one(params.next), "/map")} />;
}
