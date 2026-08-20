import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { groupTopics, searchTopics, topicForRoute, topicsForRoute } from "./help";
import { base64Bytes, buildSupportEmail, parseScreenshotDataUrl } from "./supportRequest";
import type { HelpTopic } from "./helpContent.generated";

// The help system's freshness contract:
//   * every route the header or the mobile tab bar links to resolves to a
//     docs/help topic (a page without help fails the suite, like the build);
//   * topics never leak internals or em dashes;
//   * route -> topic matching prefers the most specific route and the
//     lowest order on that route;
//   * the support email carries every context field and the transcript.

const root = process.cwd();
const helpDir = join(root, "docs", "help");

function loadTopics(): HelpTopic[] {
  return readdirSync(helpDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((f) => {
      const raw = readFileSync(join(helpDir, f), "utf8");
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!m) throw new Error(`${f}: missing front matter`);
      const meta: Record<string, string> = {};
      for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^(\w+):\s*(.*)$/);
        if (kv) meta[kv[1]] = kv[2].trim();
      }
      for (const key of ["title", "route", "group", "order", "updated", "keywords"]) {
        if (!meta[key]) throw new Error(`${f}: front matter is missing "${key}"`);
      }
      return {
        slug: f.replace(/\.md$/, ""),
        route: meta.route,
        title: meta.title,
        group: meta.group,
        order: Number(meta.order),
        updated: meta.updated,
        keywords: meta.keywords,
        body: m[2].trim(),
      };
    });
}

function navRoutes(): string[] {
  const routes = new Set<string>();
  for (const file of ["AppHeader.tsx", "MobileNav.tsx"]) {
    const src = readFileSync(join(root, "components", "layout", file), "utf8");
    for (const m of src.matchAll(/href:\s*"([^"]+)"/g)) routes.add(m[1]);
  }
  return [...routes];
}

describe("help coverage", () => {
  it("every nav route has a help topic", () => {
    const topics = loadTopics();
    const uncovered = navRoutes().filter((r) => topicForRoute(topics, r) == null);
    expect(uncovered, `routes without a docs/help topic: ${uncovered.join(", ")}`).toEqual([]);
  });

  it("help files never leak internals or em dashes", () => {
    for (const t of loadTopics()) {
      const text = `${t.title}\n${t.body}`;
      expect(text.includes("—"), `${t.slug} contains an em dash`).toBe(false);
      const lower = text.toLowerCase();
      for (const banned of ["supabase", "migration", "row level security", "postgres", "vercel", "jsonb"]) {
        expect(lower.includes(banned), `${t.slug} mentions "${banned}"`).toBe(false);
      }
    }
  });

  it("the generated module exists and matches the topic files", () => {
    const generated = join(root, "lib", "helpContent.generated.ts");
    expect(existsSync(generated)).toBe(true);
    const src = readFileSync(generated, "utf8");
    for (const t of loadTopics()) {
      expect(src.includes(JSON.stringify(t.slug)), `${t.slug} missing from generated module; run npm run help:build`).toBe(true);
    }
  });
});

const mk = (slug: string, route: string, order = 1, extra: Partial<HelpTopic> = {}): HelpTopic => ({
  slug,
  route,
  title: slug,
  group: "Map",
  order,
  updated: "2026-08-20",
  keywords: "",
  body: "",
  ...extra,
});

describe("route matching", () => {
  const topics = [
    mk("import", "/import"),
    mk("county", "/import/county"),
    mk("map", "/map", 1),
    mk("drawing", "/map", 2),
    mk("dash", "/dashboard"),
  ];
  it("prefers the most specific route", () => {
    expect(topicForRoute(topics, "/import/county")?.slug).toBe("county");
    expect(topicForRoute(topics, "/import/county/x")?.slug).toBe("county");
    expect(topicForRoute(topics, "/import")?.slug).toBe("import");
    expect(topicForRoute(topics, "/importer")).toBeNull();
  });
  it("picks the lowest order on a shared route and lists the rest", () => {
    expect(topicForRoute(topics, "/map?focus=asset:1")?.slug).toBe("map");
    expect(topicsForRoute(topics, "/map").map((t) => t.slug)).toEqual(["map", "drawing"]);
  });
  it("returns null for unknown routes", () => {
    expect(topicForRoute(topics, "/nowhere")).toBeNull();
    expect(topicForRoute(topics, null)).toBeNull();
  });
});

describe("search and grouping", () => {
  const topics = [
    mk("a", "/a", 1, { title: "Easements", keywords: "powerline", body: "Draw a strip.", group: "Properties" }),
    mk("b", "/b", 1, { title: "Leases", keywords: "rent", body: "An easement clause.", group: "Leases" }),
    mk("c", "/c", 1, { title: "Map", keywords: "layers", body: "Nothing here.", group: "Map" }),
  ];
  it("ranks title hits above body hits and requires every term", () => {
    expect(searchTopics(topics, "easement").map((t) => t.slug)).toEqual(["a", "b"]);
    expect(searchTopics(topics, "easement rent").map((t) => t.slug)).toEqual(["b"]);
    expect(searchTopics(topics, "zzz")).toEqual([]);
  });
  it("empty query returns everything in nav order", () => {
    expect(searchTopics(topics, "").map((t) => t.slug)).toEqual(["c", "a", "b"]);
  });
  it("groups in nav order", () => {
    expect(groupTopics(topics).map((g) => g.title)).toEqual(["Map", "Properties", "Leases"]);
  });
});

describe("support email", () => {
  it("carries every context field and the transcript", () => {
    const email = buildSupportEmail(
      { subject: "Map trouble", message: "The print is blank.", transcript: "Me: hi\n\nAssistant: hello" },
      { userEmail: "a@b.com", orgName: "Smith Farms", role: "owner", route: "/map", build: "abc1234", browser: "UA" }
    );
    expect(email.subject).toBe("[Turnrow Landowner support] Map trouble (Smith Farms)");
    for (const s of ["The print is blank.", "a@b.com (owner)", "Smith Farms", "Page:    /map", "Build:   abc1234", "Browser: UA", "Help chat conversation", "Assistant: hello"]) {
      expect(email.text).toContain(s);
    }
    expect(email.text.includes("—")).toBe(false);
  });
  it("defaults the subject and omits the transcript block when empty", () => {
    const email = buildSupportEmail({ subject: "", message: "x" }, { userEmail: "a@b.com", orgName: "O", role: "member", route: "/", build: "dev", browser: "UA" });
    expect(email.subject).toContain("Support request");
    expect(email.text).not.toContain("Help chat conversation");
  });
  it("parses screenshot data URLs and measures bytes", () => {
    expect(parseScreenshotDataUrl("data:image/png;base64,AAAA")?.contentType).toBe("image/png");
    expect(parseScreenshotDataUrl("data:text/plain;base64,AAAA")).toBeNull();
    expect(parseScreenshotDataUrl("nope")).toBeNull();
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AAA=")).toBe(2);
  });
});
