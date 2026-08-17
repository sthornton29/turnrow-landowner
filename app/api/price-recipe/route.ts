import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { validateExpression } from "@/lib/priceExpression";

// Custom lease pricing: the AI designs a recipe ONCE from the lease's
// pricing clause (structure only; it fetches no market data). The
// recipe lands on a review screen and saves into lease terms only on
// confirm; the app then computes it deterministically every year with
// lib/priceExpression.ts.

const RECIPE_TOOL: Anthropic.Tool = {
  name: "design_pricing_recipe",
  description:
    "Turn a lease pricing clause into a computable recipe: named inputs and an arithmetic formula.",
  input_schema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "The pricing rule restated in plain language, one or two sentences",
      },
      inputs: {
        type: "array",
        description:
          "Every number the formula needs. Names are snake_case identifiers used in the expression.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "snake_case identifier, e.g. oct_futures_avg" },
            label: { type: "string", description: "Human label, e.g. 'October futures average'" },
            source: {
              type: "string",
              enum: ["manual", "rma_projected", "rma_harvest", "tenant_average"],
              description:
                "rma_projected / rma_harvest ONLY when the clause references crop insurance projected or harvest prices; tenant_average ONLY when it references the tenant's own average price; otherwise manual.",
            },
            guidance: {
              type: ["string", "null"],
              description:
                "For manual inputs: where the human finds this number, e.g. 'CBOT ZCZ settlement, Wednesdays in October; average them yourself or enter each'. Null for auto-sourced inputs.",
            },
          },
          required: ["name", "label", "source", "guidance"],
          additionalProperties: false,
        },
      },
      expression: {
        type: "string",
        description:
          "Arithmetic over the input names: identifiers, numeric constants, + - * / and parentheses ONLY. E.g. '(projected + harvest) / 2 + 0.10'",
      },
    },
    required: ["description", "inputs", "expression"],
    additionalProperties: false,
  },
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const clause = String(body.clause ?? "").trim();
  if (clause.length < 10) {
    return NextResponse.json(
      { error: "Paste the lease's pricing clause first." },
      { status: 400 }
    );
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      tools: [RECIPE_TOOL],
      tool_choice: { type: "tool", name: RECIPE_TOOL.name },
      messages: [
        {
          role: "user",
          content: `This is the pricing clause from a farm lease. Design a computable recipe for it: named inputs (typed by source) and a simple arithmetic expression. Be honest about sourcing: only crop-insurance projected/harvest references map to rma_projected/rma_harvest and only the tenant's own average maps to tenant_average; bespoke market data (futures settlements, elevator postings) is a MANUAL input with clear guidance on where the human finds it.\n\nClause:\n${clause}`,
        },
      ],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      return NextResponse.json({ error: "No recipe returned; try rewording the clause." }, { status: 502 });
    }
    const recipe = toolUse.input as {
      description: string;
      inputs: Array<{ name: string; label: string; source: string; guidance: string | null }>;
      expression: string;
    };
    // Validate here too so a malformed proposal is caught before review.
    const check = validateExpression(
      recipe.expression,
      recipe.inputs.map((i) => i.name)
    );
    return NextResponse.json({ recipe, expression_error: check.ok ? null : check.error });
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Recipe design failed (${err.status}): ${err.message}`
        : "Recipe design failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
