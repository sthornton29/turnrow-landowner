import { describe, expect, it } from "vitest";
import {
  PriceExpressionError,
  evaluateExpression,
  substituteExpression,
  validateExpression,
} from "./priceExpression";

describe("evaluateExpression", () => {
  it("respects precedence and parentheses", () => {
    expect(evaluateExpression("2 + 3 * 4", {})).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateExpression("10 - 4 - 3", {})).toBe(3); // left assoc
    expect(evaluateExpression("12 / 3 / 2", {})).toBe(2);
  });

  it("computes the classic average-plus-basis recipe", () => {
    const result = evaluateExpression("(projected + harvest) / 2 + 0.10", {
      projected: 4.66,
      harvest: 4.2,
    });
    expect(result).toBeCloseTo(4.53, 10);
  });

  it("handles unary minus", () => {
    expect(evaluateExpression("-3 + 5", {})).toBe(2);
    expect(evaluateExpression("2 * -3", {})).toBe(-6);
    expect(evaluateExpression("-(2 + 3)", {})).toBe(-5);
  });

  it("is case-insensitive on input names", () => {
    expect(evaluateExpression("Board_Price * 0.5", { board_price: 4 })).toBe(2);
  });

  it("throws on division by zero", () => {
    expect(() => evaluateExpression("5 / 0", {})).toThrow(PriceExpressionError);
    expect(() => evaluateExpression("5 / (2 - 2)", {})).toThrow("divides by zero");
  });

  it("throws when an input has no value", () => {
    expect(() => evaluateExpression("price + 1", {})).toThrow("no value yet");
  });
});

describe("validateExpression (recipe save time)", () => {
  it("accepts a well-formed expression over declared inputs", () => {
    const result = validateExpression("(a + b) / 2", ["a", "b"]);
    expect(result.ok).toBe(true);
    expect(result.identifiers.sort()).toEqual(["a", "b"]);
  });

  it("rejects undeclared inputs by name", () => {
    const result = validateExpression("a + mystery", ["a"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("mystery");
  });

  it("rejects malformed expressions", () => {
    for (const bad of ["", "2 +", "(2 + 3", "2 3", "a ** b", "4..5 + 1", "2 + $"]) {
      expect(validateExpression(bad, ["a", "b"]).ok, bad).toBe(false);
    }
  });

  it("rejects trailing garbage", () => {
    expect(validateExpression("2 + 3) * 4", []).ok).toBe(false);
  });
});

describe("substituteExpression", () => {
  it("renders the substituted formula for review", () => {
    expect(
      substituteExpression("(projected + harvest) / 2 + 0.10", {
        projected: 4.66,
        harvest: 4.2,
      })
    ).toBe("(4.66 + 4.2) / 2 + 0.10");
  });

  it("leaves unvalued inputs by name", () => {
    expect(substituteExpression("a + b", { a: 1 })).toBe("1 + b");
  });
});
