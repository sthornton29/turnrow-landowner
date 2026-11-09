import { describe, expect, it } from "vitest";
import { matchEntity, type MatchableEntityRef } from "./taxMatch";

// Martin Trusts sorts first and carries long trust aliases that contain
// every word of shorter personal names; those used to tie at a perfect
// score with the person's own exact alias and win by list order.
const entities: MatchableEntityRef[] = [
  { id: "trusts", name: "Martin Trusts", aliases: ["VIRGINIA LARKIN MARTIN TRUST 25 % AND EL", "MARTIN DONIE NEAL TRUSTEE ETAL LAWSON SYKES MARTIN TRUST"] },
  { id: "vlm", name: "VLM", aliases: ["MARTIN VIRGINIA L"] },
  { id: "vlmdmc", name: "VLM/DMC", aliases: ["MARTIN VIRGINIA LARKIN ETAL"] },
  { id: "alb", name: "Albemarle Corporation", aliases: ["TMLLC", "T M L L C"] },
];
const m = (taxpayer: string) => matchEntity({ taxpayer_name: taxpayer, care_of: null }, entities);

describe("matchEntity prefers an exact alias over a longer name that contains its words", () => {
  it("Virginia L Martin is VLM (Redd), not Martin Trusts", () => {
    expect(m("MARTIN VIRGINIA L").entityId).toBe("vlm");
    expect(m("MARTIN VIRGINIA L").evidence).toBe('"MARTIN VIRGINIA L" matches alias "MARTIN VIRGINIA L" of VLM');
  });
  it("Virginia Larkin Martin et al is VLM/DMC (Mitchell)", () => {
    expect(m("MARTIN VIRGINIA LARKIN ETAL").entityId).toBe("vlmdmc");
  });
  it("TM LLC goes with Albemarle", () => {
    expect(m("TMLLC").entityId).toBe("alb");
  });
  it("a name that only contains another's words is reported as a close spelling, not a match", () => {
    const r = matchEntity({ taxpayer_name: "MARTIN VIRGINIA L", care_of: null }, [entities[0]]);
    expect(r.entityId).toBe("trusts");
    expect(r.evidence).toMatch(/is a close spelling of/);
  });
});
