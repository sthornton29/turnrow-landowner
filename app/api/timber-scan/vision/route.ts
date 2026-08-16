import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { bboxOf } from "@/lib/geo/normalize";
import type { MultiPolygon, Polygon } from "geojson";

// Planted vs natural pine, suggested from imagery. COST NOTE: one small
// Mapbox Static image plus one claude-sonnet-4-6 vision call PER STAND,
// only when the user asks (per stand or "suggest all pine"); never run
// automatically for a whole scan. The suggestion prefills the form
// amber-highlighted like every AI extraction; the user always confirms.

const VISION_TOOL: Anthropic.Tool = {
  name: "report_pine_pattern",
  description: "Report whether planting rows are visible in the aerial image",
  input_schema: {
    type: "object",
    properties: {
      row_pattern_visible: { type: "string", enum: ["yes", "no", "unclear"] },
      suggestion: {
        type: "string",
        enum: ["planted_pine", "natural_pine", "unclear"],
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["row_pattern_visible", "suggestion", "confidence"],
  },
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const geometry = body.geometry as Polygon | MultiPolygon | undefined;
  if (!geometry) {
    return NextResponse.json({ error: "Missing stand geometry." }, { status: 400 });
  }
  const box = bboxOf([geometry]);
  if (!box) {
    return NextResponse.json({ error: "Empty stand geometry." }, { status: 400 });
  }

  // High-zoom satellite image centered on the stand: zoom 16 resolves
  // planting rows in 30m-class stands.
  const lon = (box[0] + box[2]) / 2;
  const lat = (box[1] + box[3]) / 2;
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const imageUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lon.toFixed(5)},${lat.toFixed(5)},16/512x512@2x?access_token=${token}`;

  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: "Could not fetch imagery for this stand." },
        { status: 502 }
      );
    }
    const imageBase64 = Buffer.from(await imageResponse.arrayBuffer()).toString(
      "base64"
    );

    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      tools: [VISION_TOOL],
      tool_choice: { type: "tool", name: "report_pine_pattern" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: imageBase64 },
            },
            {
              type: "text",
              text: "This is aerial imagery of a pine timber stand in the southeastern United States. Planted pine shows parallel planting rows (straight or contour-following lines of evenly spaced trees); natural pine regeneration shows irregular, unaligned crowns. Report whether a row pattern is visible and your suggestion. If the image is ambiguous (clouds, recent thinning obscuring rows, mixed signal), say unclear rather than guessing.",
            },
          ],
        },
      ],
    });

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      return NextResponse.json({ error: "No suggestion returned." }, { status: 502 });
    }
    return NextResponse.json(toolUse.input);
  } catch {
    return NextResponse.json(
      { error: "The imagery suggestion failed; set planted or natural yourself." },
      { status: 502 }
    );
  }
}
