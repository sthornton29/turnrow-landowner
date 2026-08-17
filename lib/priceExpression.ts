// Safe arithmetic evaluator for custom lease pricing recipes. The AI
// designs a recipe ONCE (named inputs + an expression); this evaluates
// it deterministically every year. Grammar is deliberately tiny:
// numbers, named inputs, + - * /, parentheses, unary minus. NEVER eval
// or Function. Malformed expressions are rejected at recipe save time
// via validateExpression. Unit tests in priceExpression.test.ts.

export class PriceExpressionError extends Error {}

type Token =
  | { kind: "number"; value: number }
  | { kind: "identifier"; name: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < expression.length && /[0-9.]/.test(expression[j])) j++;
      const raw = expression.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value) || (raw.match(/\./g) ?? []).length > 1) {
        throw new PriceExpressionError(`"${raw}" is not a valid number.`);
      }
      tokens.push({ kind: "number", value });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < expression.length && /[a-zA-Z0-9_]/.test(expression[j])) j++;
      tokens.push({ kind: "identifier", name: expression.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    throw new PriceExpressionError(`Unexpected character "${ch}" in the formula.`);
  }
  if (tokens.length === 0) {
    throw new PriceExpressionError("The formula is empty.");
  }
  return tokens;
}

type Node =
  | { kind: "number"; value: number }
  | { kind: "input"; name: string }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: Node; right: Node }
  | { kind: "negate"; operand: Node };

function parse(expression: string): Node {
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): Node {
    let node = parseTerm();
    while (peek()?.kind === "op" && ((peek() as { op: string }).op === "+" || (peek() as { op: string }).op === "-")) {
      const op = (next() as { op: "+" | "-" }).op;
      node = { kind: "binary", op, left: node, right: parseTerm() };
    }
    return node;
  }

  function parseTerm(): Node {
    let node = parseFactor();
    while (peek()?.kind === "op" && ((peek() as { op: string }).op === "*" || (peek() as { op: string }).op === "/")) {
      const op = (next() as { op: "*" | "/" }).op;
      node = { kind: "binary", op, left: node, right: parseFactor() };
    }
    return node;
  }

  function parseFactor(): Node {
    const token = peek();
    if (!token) throw new PriceExpressionError("The formula ends unexpectedly.");
    if (token.kind === "number") {
      next();
      return { kind: "number", value: token.value };
    }
    if (token.kind === "identifier") {
      next();
      return { kind: "input", name: token.name };
    }
    if (token.kind === "op" && token.op === "-") {
      next();
      return { kind: "negate", operand: parseFactor() };
    }
    if (token.kind === "lparen") {
      next();
      const inner = parseExpr();
      if (peek()?.kind !== "rparen") {
        throw new PriceExpressionError("A closing parenthesis is missing.");
      }
      next();
      return inner;
    }
    throw new PriceExpressionError("The formula has an operator out of place.");
  }

  const root = parseExpr();
  if (pos < tokens.length) {
    throw new PriceExpressionError("The formula has extra content after the expression.");
  }
  return root;
}

function collectInputs(node: Node, into: Set<string>): void {
  if (node.kind === "input") into.add(node.name);
  else if (node.kind === "binary") {
    collectInputs(node.left, into);
    collectInputs(node.right, into);
  } else if (node.kind === "negate") collectInputs(node.operand, into);
}

// Validate at recipe save time: parses, and every identifier must be a
// declared input name.
export function validateExpression(
  expression: string,
  allowedInputs: string[]
): { ok: boolean; error: string | null; identifiers: string[] } {
  try {
    const root = parse(expression);
    const used = new Set<string>();
    collectInputs(root, used);
    const allowed = new Set(allowedInputs.map((n) => n.toLowerCase()));
    const unknown = Array.from(used).filter((n) => !allowed.has(n));
    if (unknown.length > 0) {
      return {
        ok: false,
        error: `The formula uses ${unknown.map((u) => `"${u}"`).join(", ")} which ${unknown.length === 1 ? "is not a defined input" : "are not defined inputs"}.`,
        identifiers: Array.from(used),
      };
    }
    return { ok: true, error: null, identifiers: Array.from(used) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid formula.",
      identifiers: [],
    };
  }
}

export function evaluateExpression(
  expression: string,
  values: Record<string, number>
): number {
  const root = parse(expression);
  const lookup = new Map(
    Object.entries(values).map(([k, v]) => [k.toLowerCase(), v])
  );
  const walk = (node: Node): number => {
    switch (node.kind) {
      case "number":
        return node.value;
      case "input": {
        const value = lookup.get(node.name);
        if (value === undefined || !Number.isFinite(value)) {
          throw new PriceExpressionError(`Input "${node.name}" has no value yet.`);
        }
        return value;
      }
      case "negate":
        return -walk(node.operand);
      case "binary": {
        const left = walk(node.left);
        const right = walk(node.right);
        switch (node.op) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            if (right === 0) {
              throw new PriceExpressionError("The formula divides by zero.");
            }
            return left / right;
        }
      }
    }
  };
  const result = walk(root);
  if (!Number.isFinite(result)) {
    throw new PriceExpressionError("The formula did not produce a valid number.");
  }
  return result;
}

// "(projected + harvest) / 2 + 0.10" with values substituted, for the
// review display: "(4.66 + 4.20) / 2 + 0.10".
export function substituteExpression(
  expression: string,
  values: Record<string, number>
): string {
  return expression.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (name) => {
    const value = values[name.toLowerCase()] ?? values[name];
    return value !== undefined && Number.isFinite(value)
      ? String(Math.round(value * 10000) / 10000)
      : name;
  });
}
