import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safeNext";

describe("safeNextPath", () => {
  it("keeps an ordinary path inside the app, with its query", () => {
    expect(safeNextPath("/leases/123", "/map")).toBe("/leases/123");
    expect(safeNextPath("/income?year=2026&entity=abc", "/map")).toBe("/income?year=2026&entity=abc");
    expect(safeNextPath("/reset-password", "/onboarding")).toBe("/reset-password");
  });

  it("falls back when nothing usable was given", () => {
    expect(safeNextPath(null, "/map")).toBe("/map");
    expect(safeNextPath(undefined, "/map")).toBe("/map");
    expect(safeNextPath("", "/map")).toBe("/map");
    expect(safeNextPath("   ", "/map")).toBe("/map");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of [
      "https://evil.example/login",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "@evil.example",
      ".evil.example",
      "evil.example",
      "javascript:alert(1)",
      "/ok\npath",
      "/a\u0000b",
    ]) {
      expect(safeNextPath(bad, "/map"), bad).toBe("/map");
    }
  });

  it("never sends someone back into sign-in pages or handlers", () => {
    expect(safeNextPath("/login", "/map")).toBe("/map");
    expect(safeNextPath("/login?next=/login", "/map")).toBe("/map");
    expect(safeNextPath("/signup", "/map")).toBe("/map");
    expect(safeNextPath("/auth/callback?code=x", "/map")).toBe("/map");
    expect(safeNextPath("/api/ops/data", "/map")).toBe("/map");
  });

  it("refuses an absurdly long value", () => {
    expect(safeNextPath("/" + "a".repeat(600), "/map")).toBe("/map");
  });
});
