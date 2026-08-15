import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

// AI term extraction for lease and timber sale documents. Runs server-side
// so the Anthropic API key never reaches the browser. The extraction is
// returned to the client for human review; nothing is saved here.

export const maxDuration = 120;

const LEASE_TOOL: Anthropic.Tool = {
  name: "record_lease_extraction",
  description:
    "Record the terms extracted from a farm or hunting lease document. Use null for anything the document does not state.",
  input_schema: {
    type: "object",
    properties: {
      lease_type: {
        type: "string",
        enum: ["agricultural", "hunting"],
        description: "agricultural for farm/crop leases, hunting for hunting or recreational leases",
      },
      tenant_name: { type: ["string", "null"], description: "The tenant/lessee name (person or entity)" },
      name: { type: ["string", "null"], description: "A short label for this lease, e.g. 'Smith farm lease 2026'" },
      start_date: { type: ["string", "null"], description: "Lease start date, YYYY-MM-DD" },
      end_date: { type: ["string", "null"], description: "Lease end date, YYYY-MM-DD" },
      auto_renew: { type: ["boolean", "null"], description: "Whether the lease automatically renews" },
      termination_notice_days: { type: ["integer", "null"], description: "Days of notice required to terminate or non-renew" },
      leased_acres_total: { type: ["number", "null"], description: "Total leased acres stated in the contract" },
      rent_structure: {
        type: ["string", "null"],
        enum: ["cash", "flex", "crop_share", null],
        description: "Agricultural leases only: cash rent, flex/bonus rent, or crop share. Null for hunting leases.",
      },
      terms: {
        type: "object",
        description: "Rent structure specific terms; use only the fields for the applicable structure",
        properties: {
          cash_basis: { type: ["string", "null"], enum: ["per_acre", "lump_sum", null] },
          rate_per_acre: { type: ["number", "null"], description: "Cash rent dollars per acre per year" },
          lump_sum: { type: ["number", "null"], description: "Cash rent lump sum dollars per year" },
          base_rate_per_acre: { type: ["number", "null"], description: "Flex lease base rate dollars per acre" },
          bonus_description: { type: ["string", "null"], description: "Flex lease bonus formula in plain words, e.g. '30% of gross revenue above $700/acre'" },
          landowner_share_pct: { type: ["number", "null"], description: "Crop share: landowner share of the crop, percent" },
          shares_expenses: { type: ["boolean", "null"], description: "Crop share: does the landowner share input expenses" },
          expense_share_pct: { type: ["number", "null"], description: "Crop share: landowner share of expenses, percent" },
          hunt_basis: { type: ["string", "null"], enum: ["lump_sum", "per_acre", null] },
          amount: { type: ["number", "null"], description: "Hunting lease annual dollars (lump sum)" },
          hunt_rate_per_acre: { type: ["number", "null"], description: "Hunting lease dollars per acre per year" },
          insurance_required: { type: ["boolean", "null"], description: "Hunting: does the lease require the tenant to carry liability insurance" },
        },
        additionalProperties: false,
      },
      payment_schedule: {
        type: "array",
        description: "Scheduled payments per year, 1 to 4 entries. Percent of annual rent OR fixed dollar amount per entry.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "e.g. 'First half'" },
            month: { type: "integer", description: "Due month 1-12" },
            day: { type: "integer", description: "Due day 1-31" },
            percent: { type: ["number", "null"], description: "Percent of annual rent, e.g. 50" },
            amount: { type: ["number", "null"], description: "Fixed dollar amount instead of percent" },
          },
          required: ["label", "month", "day"],
          additionalProperties: false,
        },
      },
      special_provisions: { type: ["string", "null"], description: "Renewal/termination provisions and any special provisions worth noting, condensed" },
      unsure_fields: {
        type: "array",
        items: { type: "string" },
        description: "Field names from this schema you are not confident about (ambiguous, conflicting, or barely legible in the document)",
      },
    },
    required: ["lease_type", "terms", "payment_schedule", "unsure_fields"],
    additionalProperties: false,
  },
};

const TIMBER_TOOL: Anthropic.Tool = {
  name: "record_timber_extraction",
  description:
    "Record the terms extracted from a timber sale contract. Use null for anything the document does not state.",
  input_schema: {
    type: "object",
    properties: {
      sale_name: { type: ["string", "null"], description: "Short label for this sale, e.g. 'North tract 2026 thinning'" },
      buyer_name: { type: ["string", "null"], description: "The buyer/purchaser name" },
      sale_type: {
        type: "string",
        enum: ["lump_sum", "pay_as_cut"],
        description: "lump_sum for a fixed total price; pay_as_cut when paid per unit harvested (stumpage rates)",
      },
      contract_date: { type: ["string", "null"], description: "Contract date, YYYY-MM-DD" },
      harvest_deadline: { type: ["string", "null"], description: "Harvest deadline / contract expiration, YYYY-MM-DD" },
      performance_deposit: { type: ["number", "null"], description: "Performance deposit dollars" },
      sale_acres: { type: ["number", "null"], description: "Total sale acres" },
      lump_sum_price: { type: ["number", "null"], description: "Total sale price for lump sum sales" },
      stumpage_rates: {
        type: "array",
        description: "Pay-as-cut: price per ton by product. Use the standard product slugs where they fit, otherwise a short custom slug.",
        items: {
          type: "object",
          properties: {
            product: {
              type: "string",
              description: "pine_sawtimber, pine_cns, pine_pulpwood, hardwood_sawtimber, hardwood_pulpwood, or a short custom slug",
            },
            label: { type: "string", description: "Display label, e.g. 'Pine sawtimber'" },
            price_per_ton: { type: "number", description: "Dollars per ton" },
          },
          required: ["product", "label", "price_per_ton"],
          additionalProperties: false,
        },
      },
      payment_schedule: {
        type: "array",
        description: "For lump sum sales paid in installments: each scheduled payment",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            due_date: { type: "string", description: "YYYY-MM-DD" },
            amount: { type: "number", description: "Dollars" },
          },
          required: ["label", "due_date", "amount"],
          additionalProperties: false,
        },
      },
      notes: { type: ["string", "null"], description: "Other provisions worth noting, condensed" },
      unsure_fields: {
        type: "array",
        items: { type: "string" },
        description: "Field names from this schema you are not confident about",
      },
    },
    required: ["sale_type", "stumpage_rates", "payment_schedule", "unsure_fields"],
    additionalProperties: false,
  },
};

export async function POST(request: Request) {
  // Only signed-in users may hit this (it spends API credits).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const kind = String(formData.get("kind") ?? "lease");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json(
      { error: "Only PDF documents can be extracted. Use manual entry for other formats." },
      { status: 400 }
    );
  }
  if (file.size > 30 * 1024 * 1024) {
    return NextResponse.json({ error: "PDF is too large (30 MB max)." }, { status: 400 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const tool = kind === "timber" ? TIMBER_TOOL : LEASE_TOOL;
  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            {
              type: "text",
              text:
                kind === "timber"
                  ? "Extract the terms of this timber sale contract. Only record what the document actually states; use null for anything absent. Dates as YYYY-MM-DD, dollar amounts as plain numbers. List every field you are unsure about in unsure_fields."
                  : "Extract the terms of this lease document (agricultural or hunting). Only record what the document actually states; use null for anything absent. Dates as YYYY-MM-DD, dollar amounts as plain numbers. If rent is per acre, prefer the per-acre rate over a computed total. List every field you are unsure about in unsure_fields.",
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      return NextResponse.json(
        { error: "The model did not return an extraction. Try manual entry." },
        { status: 502 }
      );
    }
    return NextResponse.json({ extraction: toolUse.input });
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Extraction failed (${err.status}): ${err.message}`
        : "Extraction failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
