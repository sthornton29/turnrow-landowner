import { describe, expect, it } from "vitest";
import {
  acresOnlyMatches,
  describeSyncReply,
  matchScore,
  nameScore,
  readJsonBody,
  seasonYear,
  suggestLocalField,
  withoutIgnoredFields,
} from "./farmDisplay";

const locals = [
  { id: "n40", name: "North 40", acres: 40.2 },
  { id: "s40", name: "South 40", acres: 39.8 },
  { id: "creek", name: "Creek Bottom", acres: 112 },
];

describe("field match suggestions", () => {
  it("scores a name on its own: same, contained, a shared word, nothing", () => {
    expect(nameScore("North 40", "north 40")).toBe(2);
    expect(nameScore("North 40 East", "North 40")).toBe(1);
    expect(nameScore("Creek Field", "Creek Bottom")).toBe(0.5);
    expect(nameScore("Home Place", "Creek Bottom")).toBe(0);
    expect(nameScore(null, "Creek Bottom")).toBe(0);
  });

  it("a shared number is an acreage, not a name: North 40 and South 40 have nothing in common", () => {
    expect(nameScore("North 40", "South 40")).toBe(0);
    expect(nameScore("Tract 12", "Field 12")).toBe(0);
  });

  it("pre-selects on a name signal, with acres breaking ties", () => {
    expect(suggestLocalField({ name: "North 40", acres: 40 }, locals)?.id).toBe("n40");
    // The same name with no acres on the farm side still matches.
    expect(suggestLocalField({ name: "Creek Bottom", acres: null }, locals)?.id).toBe("creek");
    // A shared word plus acres within 15 percent is enough.
    expect(suggestLocalField({ name: "Creek Field", acres: 105 }, locals)?.id).toBe("creek");
  });

  it("never pre-selects on acreage alone", () => {
    // 40.0 acres is within 5 percent of both 40-acre fields; the name
    // ("Back Forty") matches neither. This used to pre-select North 40.
    const remote = { name: "Back Forty", acres: 40 };
    expect(matchScore(remote, locals[0])).toBe(1);
    expect(suggestLocalField(remote, locals)).toBeNull();
    expect(suggestLocalField({ name: null, acres: 112 }, locals)).toBeNull();
  });

  it("a shared word alone, with acres far apart, is not enough either", () => {
    expect(suggestLocalField({ name: "Creek Field", acres: 20 }, locals)).toBeNull();
  });

  it("offers same-size fields as a hint instead", () => {
    expect(acresOnlyMatches({ name: "Back Forty", acres: 40 }, locals).map((f) => f.id)).toEqual(["n40", "s40"]);
    // A field that matches by name is a real suggestion, not an acres-only one.
    expect(acresOnlyMatches({ name: "North 40", acres: 40 }, locals).map((f) => f.id)).toEqual(["s40"]);
    // 15 percent off is not "the same size".
    expect(acresOnlyMatches({ name: "Back Forty", acres: 46 }, locals)).toEqual([]);
    expect(acresOnlyMatches({ name: "Back Forty", acres: null }, locals)).toEqual([]);
  });
});

describe("ignored fields", () => {
  const rows = [
    { farm_connection_id: "c1", remote_field_id: "a", planted_acres: 100 },
    { farm_connection_id: "c1", remote_field_id: "b", planted_acres: 40 },
    { farm_connection_id: "c2", remote_field_id: "a", planted_acres: 25 },
  ];

  it("drops the plantings of a field marked Ignore, on that connection only", () => {
    const kept = withoutIgnoredFields(rows, [
      { farm_connection_id: "c1", remote_field_id: "a", status: "ignored" },
      { farm_connection_id: "c1", remote_field_id: "b", status: "confirmed" },
      { farm_connection_id: "c2", remote_field_id: "zzz", status: "ignored" },
    ]);
    expect(kept.map((r) => `${r.farm_connection_id}/${r.remote_field_id}`)).toEqual(["c1/b", "c2/a"]);
    expect(kept.reduce((s, r) => s + r.planted_acres, 0)).toBe(65);
  });

  it("keeps everything when nothing is ignored", () => {
    expect(withoutIgnoredFields(rows, [])).toEqual(rows);
    expect(withoutIgnoredFields(rows, [{ farm_connection_id: "c1", remote_field_id: "a", status: "suggested" }])).toHaveLength(3);
  });
});

describe("seasonYear", () => {
  it("shows the current crop year once it has plantings, otherwise the prior year", () => {
    expect(seasonYear([{ crop_year: 2026 }, { crop_year: 2027 }], 2027)).toBe(2027);
    // January: nothing planted for the new year yet, last year's harvest is finishing.
    expect(seasonYear([{ crop_year: 2026 }, { crop_year: 2025 }], 2027)).toBe(2026);
    expect(seasonYear([], 2027)).toBe(2027);
    expect(seasonYear([{ crop_year: 2024 }], 2027)).toBe(2027);
  });
});

describe("reading a sync reply", () => {
  const res = (text: string) => ({ text: async () => text });

  it("parses JSON and survives a web page, an empty body, or a broken stream", async () => {
    expect(await readJsonBody(res('{"results":[]}'))).toEqual({ results: [] });
    expect(await readJsonBody(res("<html><body>504 Gateway Timeout</body></html>"))).toBeNull();
    expect(await readJsonBody(res(""))).toBeNull();
    expect(await readJsonBody(res('"just a string"'))).toBeNull();
    expect(await readJsonBody({ text: async () => { throw new Error("Load failed"); } })).toBeNull();
  });

  it("always ends in a sentence: success", () => {
    expect(describeSyncReply(200, { results: [{ ok: true, fields: 1204, plantings: 1, tenants: { created: 2, linked: 1 } }] })).toEqual({
      ok: true,
      text: "Synced 1,204 fields and 1 planting; 2 tenants created, 1 linked from the farm's entities.",
    });
    expect(describeSyncReply(200, { results: [{ ok: true, fields: 3, plantings: 0 }] }).text).toBe("Synced 3 fields and 0 plantings.");
  });

  it("always ends in a sentence: the farm software's reason, a timeout page, signed out, nothing synced", () => {
    expect(describeSyncReply(200, { results: [{ ok: false, error: "Your farmer has ended or changed this share." }] })).toEqual({
      ok: false,
      text: "The sync did not finish: Your farmer has ended or changed this share.",
    });
    // A gateway timeout answers with a web page: no body, not a 200.
    const timeout = describeSyncReply(504, null);
    expect(timeout.ok).toBe(false);
    expect(timeout.text).toMatch(/did not go through/);
    expect(describeSyncReply(401, { error: "Not authenticated" }).text).toMatch(/signed out/);
    expect(describeSyncReply(200, { results: [] })).toMatchObject({ ok: false });
    expect(describeSyncReply(200, null)).toMatchObject({ ok: false });
    // A server error never shows its own text (it may name a setting or a table).
    expect(describeSyncReply(500, { error: "SUPABASE_SERVICE_ROLE_KEY is not configured." }).text).not.toMatch(/SUPABASE/);
  });
});
