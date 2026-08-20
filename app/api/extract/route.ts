import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  collapseLoads,
  csvToRows,
  workbookToRows,
  type SettlementColumnMap,
} from "@/lib/timberSettlement";
import { checkRateLimit, rateLimited429 } from "@/lib/rateLimit";
import { MODEL_PDF_MAX_BYTES, firstPages, pageCount, splitPdf } from "./pdfChunks";
import { mergeFsaExtractions } from "@/lib/gov/fsaImport";
import {
  VAULT_KINDS,
  VAULT_PROMPTS,
  VAULT_TOOLS,
  type VaultKind,
} from "./vaultTools";

// AI term extraction for lease and timber sale documents. Runs server-side
// so the Anthropic API key never reaches the browser. The extraction is
// returned to the client for human review; nothing is saved here.

// Long FSA packets scan in several chunks; Vercel Pro allows up to 300 s.
export const maxDuration = 300;

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
      price_method: {
        type: ["string", "null"],
        enum: ["manual", "tenant_average", "rma_benchmark", "custom", null],
        description:
          "Crop share and flex leases only: how the lease establishes the average crop price. tenant_average when the price is the tenant's/operator's own average selling price; rma_benchmark when it references crop insurance projected/harvest prices, RMA, or spring/fall price discovery; custom when the clause defines its own formula (futures settlements on specific dates, elevator posted price plus basis, etc.); manual when the lease is silent or prices are simply agreed each year. Null for cash and hunting leases.",
      },
      pricing_clause: {
        type: ["string", "null"],
        description:
          "The lease's pricing clause VERBATIM (the sentences defining how the price is determined), for later recipe setup. Null if the document has none.",
      },
      leased_properties: {
        type: "array",
        description:
          "Every distinct tract/farm/property the lease covers, one entry per tract (a lease can cover several). Pull the identifiers the document actually uses: farm names, roads/communities, county, stated acres, FSA farm/tract numbers, tax parcel numbers, legal description fragments. Empty array if the document does not identify the land.",
        items: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description:
                "How the document identifies this land, condensed, e.g. 'the Blythe farm on CR 34, approx. 250 acres'",
            },
            acres: { type: ["number", "null"], description: "Acres stated for this tract" },
            county: { type: ["string", "null"] },
            state: { type: ["string", "null"] },
            fsa_numbers: {
              type: "array",
              items: { type: "string" },
              description: "FSA farm/tract numbers mentioned for this land",
            },
            parcel_numbers: {
              type: "array",
              items: { type: "string" },
              description: "Tax parcel numbers mentioned for this land",
            },
          },
          required: ["description", "fsa_numbers", "parcel_numbers"],
          additionalProperties: false,
        },
      },
      unsure_fields: {
        type: "array",
        items: { type: "string" },
        description: "Field names from this schema you are not confident about (ambiguous, conflicting, or barely legible in the document)",
      },
    },
    required: ["lease_type", "terms", "payment_schedule", "leased_properties", "unsure_fields"],
    additionalProperties: false,
  },
};

const TIMBER_PRODUCT_SLUGS =
  "pine_sawtimber, pine_cns, pine_pulpwood, hardwood_sawtimber, hardwood_pulpwood, poles_pilings, veneer_peeler, crossties, topwood_chips, or a short custom slug";

const TIMBER_TOOL: Anthropic.Tool = {
  name: "record_timber_extraction",
  description:
    "Record the terms extracted from a timber sale contract (lump sum by timber deed/sale agreement, pay-as-cut stumpage agreement possibly with supplements, delivered-price arrangement, or salvage sale). Use null for anything the document does not state.",
  input_schema: {
    type: "object",
    properties: {
      sale_name: { type: ["string", "null"], description: "Short label for this sale, e.g. 'North tract 2026 thinning'" },
      buyer_name: { type: ["string", "null"], description: "The buyer/purchaser name" },
      sale_type: {
        type: "string",
        enum: ["lump_sum", "pay_as_cut", "delivered_net"],
        description:
          "lump_sum for a fixed total price conveyed by timber deed or sale agreement (sealed bid or negotiated); pay_as_cut when paid per unit harvested at stumpage rates from scale tickets; delivered_net when rates are a delivered/mill price minus cut-and-haul (net to landowner)",
      },
      harvest_type: {
        type: ["string", "null"],
        enum: ["clearcut", "first_thinning", "second_thinning", "select_cut", "salvage", "other", null],
        description: "The cutting type: clearcut, first or second thinning, select or seed-tree cut, salvage. Null when the contract does not say.",
      },
      tract_description: {
        type: ["string", "null"],
        description:
          "How the contract describes the land/tract/stands being sold, condensed but keeping distinctive names, acreages, and landmarks (used to suggest which mapped timber stands this sale covers)",
      },
      contract_date: { type: ["string", "null"], description: "Contract date, YYYY-MM-DD" },
      harvest_deadline: { type: ["string", "null"], description: "Harvest deadline / contract expiration, YYYY-MM-DD" },
      performance_deposit: { type: ["number", "null"], description: "Performance deposit dollars" },
      sale_acres: { type: ["number", "null"], description: "Total sale acres" },
      lump_sum_price: { type: ["number", "null"], description: "Total sale price for lump sum sales" },
      stumpage_rates: {
        type: "array",
        description:
          "Per-unit sales: the rate per product. Default unit is $/ton; hardwood sawtimber sometimes sells $/MBF with a log scale (Doyle default in the Southeast). For delivered-price sales record the NET rate to the landowner.",
        items: {
          type: "object",
          properties: {
            product: {
              type: "string",
              description: TIMBER_PRODUCT_SLUGS,
            },
            label: { type: "string", description: "Display label, e.g. 'Pine sawtimber'" },
            rate: { type: "number", description: "Dollars per unit" },
            unit: { type: "string", enum: ["ton", "mbf"], description: "ton unless the contract prices by thousand board feet" },
            log_scale: {
              type: ["string", "null"],
              enum: ["doyle", "scribner", "international", null],
              description: "MBF rates only: the log scale named (doyle if unstated)",
            },
          },
          required: ["product", "label", "rate", "unit"],
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
      notes: {
        type: ["string", "null"],
        description:
          "Provisions worth surfacing, condensed: penalty clauses (e.g. per-tree damages), BMP/streamside requirements, master stumpage agreement or supplement references, road/gate obligations, and anything unusual",
      },
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

// Logger/mill settlement statements as PDFs or photos: per-load detail
// collapses to one line per product (keeping load count and date
// range); period summaries record as printed.
const TIMBER_SETTLEMENT_TOOL: Anthropic.Tool = {
  name: "record_timber_settlement",
  description:
    "Record what this logger or mill settlement statement shows. Collapse per-load/scale-ticket detail to ONE line per product, keeping the load count and date range. Use null for anything not shown.",
  input_schema: {
    type: "object",
    properties: {
      payer_name: { type: ["string", "null"], description: "The settling party (logger, mill, or timber buyer), exactly as printed" },
      date: { type: ["string", "null"], description: "Settlement/check date, YYYY-MM-DD" },
      period_start: { type: ["string", "null"], description: "Start of the period the statement covers, YYYY-MM-DD" },
      period_end: { type: ["string", "null"], description: "End of the period, YYYY-MM-DD" },
      check_number: { type: ["string", "null"] },
      total_amount: { type: ["number", "null"], description: "Total dollars to the landowner" },
      lines: {
        type: "array",
        description: "One line per product across the statement",
        items: {
          type: "object",
          properties: {
            product: { type: "string", description: TIMBER_PRODUCT_SLUGS },
            label: { type: "string", description: "The product as the statement prints it" },
            quantity: { type: "number", description: "Total units for the product across the statement" },
            unit: { type: "string", enum: ["ton", "mbf"], description: "ton for net tons; mbf for thousand board feet" },
            rate: { type: ["number", "null"], description: "Dollars per unit paid (weighted average if loads vary)" },
            amount: { type: ["number", "null"], description: "Total dollars for the product" },
            load_count: { type: ["integer", "null"], description: "Number of loads/tickets collapsed into this line" },
            date_from: { type: ["string", "null"], description: "Earliest load date, YYYY-MM-DD" },
            date_to: { type: ["string", "null"], description: "Latest load date, YYYY-MM-DD" },
          },
          required: ["product", "label", "quantity", "unit"],
          additionalProperties: false,
        },
      },
      unsure_fields: {
        type: "array",
        items: { type: "string" },
        description: "Field names you are not confident about",
      },
    },
    required: ["lines", "unsure_fields"],
    additionalProperties: false,
  },
};

// Spreadsheet settlements: the model only maps columns and product
// spellings; the per-load rows collapse deterministically in
// lib/timberSettlement.ts (unit-tested), never by the model.
const SETTLEMENT_COLUMNS_TOOL: Anthropic.Tool = {
  name: "record_settlement_columns",
  description:
    "Map the columns and product names of this settlement spreadsheet. Row and column indexes are 0-based, matching the row numbers shown.",
  input_schema: {
    type: "object",
    properties: {
      header_row: { type: "integer", description: "0-based index of the header row; data rows follow it" },
      ticket_col: { type: ["integer", "null"], description: "Column with the load/scale ticket number" },
      date_col: { type: ["integer", "null"], description: "Column with the load or line date" },
      product_col: { type: "integer", description: "Column with the product name" },
      quantity_col: { type: "integer", description: "Column with the net tons (or MBF) per row" },
      rate_col: { type: ["integer", "null"], description: "Column with the dollars-per-unit rate" },
      amount_col: { type: ["integer", "null"], description: "Column with the landowner dollars per row" },
      quantity_unit: { type: "string", enum: ["ton", "mbf"], description: "Unit of the quantity column" },
      products: {
        type: "array",
        description: "Every distinct product spelling in the product column, mapped to a slug",
        items: {
          type: "object",
          properties: {
            raw: { type: "string", description: "The spelling exactly as it appears" },
            product: { type: "string", description: TIMBER_PRODUCT_SLUGS },
            label: { type: "string", description: "Clean display label" },
          },
          required: ["raw", "product", "label"],
          additionalProperties: false,
        },
      },
      payer_name: { type: ["string", "null"], description: "The settling party if named anywhere in the sheet" },
      settlement_date: { type: ["string", "null"], description: "Settlement date if shown, YYYY-MM-DD" },
      check_number: { type: ["string", "null"] },
      unsure_fields: {
        type: "array",
        items: { type: "string" },
        description: "Field names you are not confident about",
      },
    },
    required: ["header_row", "product_col", "quantity_col", "quantity_unit", "products", "unsure_fields"],
    additionalProperties: false,
  },
};

const TAX_TOOL: Anthropic.Tool = {
  name: "record_tax_extraction",
  description:
    "Record the details extracted from a property tax statement (PDF or photo). Use null for anything not shown.",
  input_schema: {
    type: "object",
    properties: {
      county: { type: ["string", "null"], description: "County name (without the word 'County')" },
      state: { type: ["string", "null"], description: "Two-letter state, e.g. AL" },
      authority_name: { type: ["string", "null"], description: "Taxing authority exactly as printed, e.g. 'Sumter County Revenue Commissioner'" },
      parcel_number: { type: ["string", "null"], description: "Parcel/PPIN number exactly as printed, keeping its punctuation" },
      tax_year: { type: ["integer", "null"], description: "Tax year the statement covers" },
      assessed_value: { type: ["number", "null"], description: "Assessed value in dollars" },
      amount_due: { type: ["number", "null"], description: "Total amount due in dollars" },
      due_date: { type: ["string", "null"], description: "Due date if printed, YYYY-MM-DD" },
      owner_name: { type: ["string", "null"], description: "Owner name exactly as printed" },
      unsure_fields: {
        type: "array",
        items: { type: "string" },
        description: "Field names you are not confident about (blurry, ambiguous, or partially visible)",
      },
    },
    required: ["unsure_fields"],
    additionalProperties: false,
  },
};

const PAYMENT_TOOL: Anthropic.Tool = {
  name: "record_payment_extraction",
  description:
    "Record what this rent payment document shows: a check image (often a phone photo) or a crop share / timber settlement sheet. Use null for anything not shown.",
  input_schema: {
    type: "object",
    properties: {
      document_kind: {
        type: "string",
        enum: ["check", "settlement", "timber_settlement", "other"],
        description:
          "check for a bank check image; settlement for a crop share / grain settlement sheet; timber_settlement when it reads as a timber harvest settlement (tons by product at stumpage rates); other when unclear",
      },
      payer_name: {
        type: ["string", "null"],
        description: "Who the payment is from (the check writer / settling party), exactly as printed",
      },
      date: { type: ["string", "null"], description: "Check or settlement date, YYYY-MM-DD" },
      total_amount: { type: ["number", "null"], description: "Total dollars paid to the landowner" },
      check_number: { type: ["string", "null"], description: "Check number if shown" },
      memo: { type: ["string", "null"], description: "Check memo line or settlement reference, verbatim" },
      lines: {
        type: "array",
        description:
          "Settlement sheets only: the line detail when present (crop, quantity, price, share math). Empty for plain checks.",
        items: {
          type: "object",
          properties: {
            crop: { type: ["string", "null"] },
            units: { type: ["number", "null"], description: "Bushels/lbs/units on the line" },
            unit: { type: ["string", "null"], description: "bu, lbs, tons..." },
            price_per_unit: { type: ["number", "null"] },
            share_pct: { type: ["number", "null"], description: "Landowner share percent applied, when shown" },
            amount: { type: ["number", "null"], description: "Line dollars to the landowner" },
          },
          required: [],
          additionalProperties: false,
        },
      },
      yields: {
        type: "array",
        description:
          "When the settlement states yields (or acres + production allowing one), per crop. Empty otherwise.",
        items: {
          type: "object",
          properties: {
            crop: { type: "string" },
            yield_per_acre: { type: ["number", "null"] },
            acres: { type: ["number", "null"] },
            price_per_unit: { type: ["number", "null"] },
          },
          required: ["crop"],
          additionalProperties: false,
        },
      },
      timber_lines: {
        type: "array",
        description:
          "Timber settlements only: tons by product at price per ton. Empty otherwise.",
        items: {
          type: "object",
          properties: {
            product: { type: "string", description: "e.g. pine sawtimber, hardwood pulpwood" },
            tons: { type: ["number", "null"] },
            price_per_ton: { type: ["number", "null"] },
            amount: { type: ["number", "null"] },
          },
          required: ["product"],
          additionalProperties: false,
        },
      },
      unsure_fields: {
        type: "array",
        items: { type: "string" },
        description: "Field names you are not confident about (blurry, ambiguous, partially visible)",
      },
    },
    required: ["document_kind", "lines", "yields", "timber_lines", "unsure_fields"],
    additionalProperties: false,
  },
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

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

  // Per-user hourly limit across every extraction kind (session client;
  // the assistant_usage table is under the org's RLS).
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  const limit = await checkRateLimit(supabase, {
    userId: user.id,
    orgId: profile?.organization_id ?? null,
    kind: "extract",
    limitPerHour: 60,
  });
  if (!limit.allowed) return rateLimited429("extract");

  const formData = await request.formData();
  let file = formData.get("file");
  const kind = String(formData.get("kind") ?? "lease");
  // Already-stored documents are scanned BY PATH: the server pulls the
  // file from storage under the caller's session (RLS applies), so a
  // 60 MB packet never has to travel through the 4.5 MB request body
  // limit of the function.
  const storagePath = String(formData.get("storage_path") ?? "");
  if (!(file instanceof File) && storagePath) {
    const { data: blob, error: dlErr } = await supabase.storage
      .from("documents")
      .download(storagePath);
    if (dlErr || !blob) {
      return NextResponse.json({ error: "Could not read that file from storage." }, { status: 404 });
    }
    file = new File([blob], String(formData.get("file_name") ?? "document"), {
      type: String(formData.get("content_type") ?? "") || blob.type || "application/pdf",
    });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  const isPdf = file.type === "application/pdf";
  const isImage = (IMAGE_TYPES as readonly string[]).includes(file.type);
  const lowerName = file.name.toLowerCase();
  const isCsv = lowerName.endsWith(".csv") || file.type === "text/csv";
  const isExcel =
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "application/vnd.ms-excel";
  const isSpreadsheet = isCsv || isExcel;
  // Tax statements, rent checks, and timber contracts can be phone
  // photos; leases are PDFs; logger/mill settlements arrive as PDFs,
  // photos, or Excel/CSV exports.
  const isVaultKind = (VAULT_KINDS as readonly string[]).includes(kind);
  const allowsImages =
    kind === "tax" ||
    kind === "payment" ||
    kind === "timber" ||
    kind === "timber_settlement" ||
    isVaultKind;
  const allowed =
    kind === "timber_settlement"
      ? isPdf || isImage || isSpreadsheet
      : allowsImages
        ? isPdf || isImage
        : isPdf;
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          kind === "timber_settlement"
            ? "Upload a PDF, a photo (JPEG, PNG, or WebP), or an Excel/CSV settlement export."
            : allowsImages
              ? "Upload a PDF or a photo (JPEG, PNG, or WebP). iPhone HEIC photos need to be shared as JPEG."
              : "Only PDF documents can be extracted. Use manual entry for other formats.",
      },
      { status: 400 }
    );
  }
  // PDFs may be long scans (a 156EZ packet, a deed book run); the vault
  // branch splits them into page chunks. Photos and spreadsheets stay
  // at 30 MB.
  const sizeCap = isPdf && isVaultKind ? 100 * 1024 * 1024 : 30 * 1024 * 1024;
  if (file.size > sizeCap) {
    return NextResponse.json(
      { error: isPdf && isVaultKind ? "File is too large (100 MB max). Split the PDF and scan the parts." : "File is too large (30 MB max)." },
      { status: 400 }
    );
  }

  const client = new Anthropic();

  // Spreadsheet settlements: the model maps columns and product names;
  // the per-load rows collapse to per-product period lines in
  // deterministic, unit-tested code (lib/timberSettlement.ts).
  if (kind === "timber_settlement" && isSpreadsheet) {
    let rows;
    try {
      rows = isCsv
        ? csvToRows(await file.text())
        : workbookToRows(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return NextResponse.json(
        { error: "Could not read the spreadsheet. Try exporting it again as .xlsx or .csv." },
        { status: 400 }
      );
    }
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "The spreadsheet has no rows." },
        { status: 400 }
      );
    }
    const gridText = rows
      .slice(0, 200)
      .map(
        (r, i) =>
          `${i}: ` +
          r.map((c) => (c === null ? "" : String(c).slice(0, 40))).join(" | ")
      )
      .join("\n");
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        tools: [SETTLEMENT_COLUMNS_TOOL],
        tool_choice: { type: "tool", name: SETTLEMENT_COLUMNS_TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "This is a timber settlement spreadsheet (logger or mill statement), one row per line shown as '<row index>: cell | cell | ...'. Map the columns and every distinct product spelling. Indexes are 0-based. Only map what is actually there.\n\n" +
                  gridText +
                  (rows.length > 200 ? `\n(${rows.length - 200} more rows not shown)` : ""),
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
          { error: "The model could not map the spreadsheet. Enter the settlement manually." },
          { status: 502 }
        );
      }
      const m = toolUse.input as {
        header_row: number;
        ticket_col?: number | null;
        date_col?: number | null;
        product_col: number;
        quantity_col: number;
        rate_col?: number | null;
        amount_col?: number | null;
        quantity_unit: "ton" | "mbf";
        products: SettlementColumnMap["products"];
        payer_name?: string | null;
        settlement_date?: string | null;
        check_number?: string | null;
        unsure_fields: string[];
      };
      const lines = collapseLoads(rows, {
        header_row: m.header_row,
        ticket: m.ticket_col,
        date: m.date_col,
        product: m.product_col,
        quantity: m.quantity_col,
        rate: m.rate_col,
        amount: m.amount_col,
        unit: m.quantity_unit,
        products: m.products ?? [],
      });
      if (lines.length === 0) {
        return NextResponse.json(
          { error: "No settlement rows could be read from the spreadsheet. Enter it manually." },
          { status: 422 }
        );
      }
      const total =
        Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
      const fromDates = lines.map((l) => l.date_from).filter(Boolean) as string[];
      const toDates = lines.map((l) => l.date_to).filter(Boolean) as string[];
      return NextResponse.json({
        extraction: {
          payer_name: m.payer_name ?? null,
          date: m.settlement_date ?? null,
          period_start: fromDates.sort()[0] ?? null,
          period_end: toDates.sort()[toDates.length - 1] ?? null,
          check_number: m.check_number ?? null,
          total_amount: total,
          lines,
          source_rows: rows.length,
          unsure_fields: m.unsure_fields ?? [],
        },
      });
    } catch (err) {
      const message =
        err instanceof Anthropic.APIError
          ? `Extraction failed (${err.status}): ${err.message}`
          : "Extraction failed.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  const fileBytes = Buffer.from(await file.arrayBuffer());
  const base64 = fileBytes.toString("base64");

  // Document vault kinds: classification, per-type extraction, and the
  // legal description parse. Same forced-tool contract; upstream error
  // text is logged, never echoed to the browser. Long PDFs are split
  // into page chunks (pdfChunks.ts): classification reads the first 20
  // pages, single-record scans the first 90 (and say so), and 156EZ
  // packets read EVERY chunk and merge farms by farm number.
  if (isVaultKind) {
    const vaultKind = kind as VaultKind;
    const vtool = VAULT_TOOLS[vaultKind];
    const blockFor = (bytes: Buffer): Anthropic.ContentBlockParam =>
      isPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } }
        : { type: "image", source: { type: "base64",
            media_type: file.type as (typeof IMAGE_TYPES)[number], data: base64 } };
    let promptText = VAULT_PROMPTS[vaultKind];
    if (vaultKind === "classify" || vaultKind === "intake") {
      // The owner's matching context: property names with county,
      // normalized parcel numbers, FSA farm numbers, acres; and (intake)
      // entity names with confirmed aliases. The model names matches off
      // these lists and cites the signal; the client verifies every
      // claim deterministically before showing it as found.
      const rawContext = formData.get("context");
      if (typeof rawContext === "string" && rawContext.length < 300_000) {
        try {
          const parsed = JSON.parse(rawContext) as unknown;
          const propsRaw: unknown[] = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === "object" && Array.isArray((parsed as { properties?: unknown }).properties)
              ? ((parsed as { properties: unknown[] }).properties)
              : [];
          const entsRaw: unknown[] =
            parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as { entities?: unknown }).entities)
              ? ((parsed as { entities: unknown[] }).entities)
              : [];
          const strs = (v: unknown) =>
            Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 40).map((x) => String(x).slice(0, 60)) : [];
          const lines = propsRaw.slice(0, 200).flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const o = item as Record<string, unknown>;
            const name = typeof o.name === "string" ? o.name.trim().slice(0, 120) : "";
            if (!name) return [];
            const parts = [
              typeof o.county === "string" && o.county ? `${o.county} County` : null,
              typeof o.state === "string" && o.state ? o.state : null,
              typeof o.acres === "number" ? `${Math.round(o.acres * 10) / 10} acres` : null,
              strs(o.parcel_numbers).length ? `parcels ${strs(o.parcel_numbers).join(", ")}` : null,
              strs(o.fsa_numbers).length ? `FSA farms ${strs(o.fsa_numbers).join(", ")}` : null,
            ].filter(Boolean);
            return [`- "${name}"${parts.length ? `: ${parts.join("; ")}` : ""}`];
          });
          const entLines = entsRaw.slice(0, 200).flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const o = item as Record<string, unknown>;
            const name = typeof o.name === "string" ? o.name.trim().slice(0, 120) : "";
            if (!name) return [];
            const aliases = strs(o.aliases);
            return [`- "${name}"${aliases.length ? ` (also recorded as ${aliases.join("; ")})` : ""}`];
          });
          if (lines.length > 0) {
            promptText +=
              "\n\nThe owner's properties are:\n" +
              lines.join("\n") +
              "\n\nIn matched_properties, name which of THESE properties the document concerns (by parcel numbers, FSA farm numbers, the property's name, an owner/party name, or county). Use the names exactly as listed; never invent a name; leave it empty when nothing ties the document to a listed property.";
          }
          if (vaultKind === "intake" && entLines.length > 0) {
            promptText +=
              "\n\nThe owner's entities (how title is held) are:\n" +
              entLines.join("\n") +
              "\n\nIn matched_entity, name the listed entity whose name or alias appears as a party on the page, or null.";
          }
        } catch {
          // Malformed context: proceed without it.
        }
      }
    }
    const runTool = async (
      bytes: Buffer,
      text: string,
      toolOverride?: Anthropic.Tool
    ): Promise<Record<string, unknown>> => {
      const useTool = toolOverride ?? vtool;
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: vaultKind === "classify" ? 1536 : 8192,
        tools: [useTool],
        tool_choice: { type: "tool", name: useTool.name },
        messages: [{ role: "user", content: [blockFor(bytes), { type: "text", text }] }],
      });
      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (!toolUse) throw new Error("no tool use");
      return toolUse.input as Record<string, unknown>;
    };
    // Every 90-page chunk of a 156EZ packet, two at a time, merged by
    // farm number. Shared by the fsa_156ez kind and the intake pass.
    const scanFsaPacket = async (): Promise<Record<string, unknown>> => {
      const chunks = await splitPdf(fileBytes, { maxPages: 90, maxBytes: MODEL_PDF_MAX_BYTES });
      const total = await pageCount(fileBytes);
      const results: Array<Record<string, unknown>> = new Array(chunks.length);
      let next = 0;
      const fsaPrompt = VAULT_PROMPTS.fsa_156ez;
      const worker = async () => {
        while (next < chunks.length) {
          const i = next++;
          const r = await runTool(
            chunks[i],
            fsaPrompt + (chunks.length > 1 ? ` (These are pages of part ${i + 1} of ${chunks.length} of one packet.)` : ""),
            VAULT_TOOLS.fsa_156ez
          );
          r.pages_scanned = Math.ceil(total / chunks.length);
          r.total_pages = total;
          results[i] = r;
        }
      };
      await Promise.all([worker(), worker()]);
      const merged = mergeFsaExtractions(results) as unknown as Record<string, unknown>;
      merged.pages_scanned = total;
      merged.total_pages = total;
      merged.chunks = chunks.length;
      return merged;
    };
    try {
      let extraction: Record<string, unknown>;
      if (vaultKind === "intake") {
        // One pass on the first 20 pages (a photo goes in whole). A
        // 156EZ packet longer than that gets the full chunked farm scan
        // inside the same request so the user still sees one pass.
        if (!isPdf) {
          extraction = await runTool(fileBytes, promptText);
        } else {
          const first = await firstPages(fileBytes, 20);
          extraction = await runTool(first.bytes, promptText);
          extraction.pages_scanned = first.pages;
          extraction.total_pages = first.total;
          if (extraction.doc_type === "fsa_156ez" && first.total > first.pages) {
            const packet = await scanFsaPacket();
            const fields = (extraction.fields ?? {}) as Record<string, unknown>;
            fields.farms = packet.farms ?? [];
            extraction.fields = fields;
            extraction.pages_scanned = packet.pages_scanned;
            extraction.chunks = packet.chunks;
            const unsure = Array.isArray(extraction.unsure_fields) ? (extraction.unsure_fields as unknown[]).map(String) : [];
            const more = Array.isArray(packet.unsure_fields) ? (packet.unsure_fields as unknown[]).map(String) : [];
            extraction.unsure_fields = [...new Set([...unsure, ...more])];
          }
        }
      } else if (!isPdf) {
        extraction = await runTool(fileBytes, promptText);
      } else if (vaultKind === "classify") {
        const first = await firstPages(fileBytes, 20);
        extraction = await runTool(first.bytes, promptText);
        extraction.pages_scanned = first.pages;
        extraction.total_pages = first.total;
      } else if (vaultKind === "fsa_156ez") {
        extraction = await scanFsaPacket();
      } else {
        const first = await firstPages(fileBytes, 90);
        extraction = await runTool(first.bytes, promptText);
        extraction.pages_scanned = first.pages;
        extraction.total_pages = first.total;
        if (first.total > first.pages) {
          const unsure = Array.isArray(extraction.unsure_fields) ? (extraction.unsure_fields as unknown[]).map(String) : [];
          unsure.push(`Only the first ${first.pages} of ${first.total} pages were read`);
          extraction.unsure_fields = unsure;
        }
      }
      return NextResponse.json({ extraction, kind: vaultKind });
    } catch (err) {
      if (err instanceof Error && err.message === "no tool use") {
        return NextResponse.json(
          { error: "The model did not return an extraction. Try again or enter the details by hand." },
          { status: 502 }
        );
      }
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      console.error("extract vault kind failed", vaultKind, status, err instanceof Error ? err.message : err);
      return NextResponse.json(
        {
          error:
            status === 413
              ? "This file is too large for the reader in one piece. Split the PDF into smaller parts, or enter the details by hand."
              : status
                ? `Extraction failed (${status}).`
                : "Extraction failed.",
        },
        { status: 502 }
      );
    }
  }

  const tool =
    kind === "timber"
      ? TIMBER_TOOL
      : kind === "timber_settlement"
        ? TIMBER_SETTLEMENT_TOOL
        : kind === "tax"
          ? TAX_TOOL
          : kind === "payment"
            ? PAYMENT_TOOL
            : LEASE_TOOL;

  const fileBlock: Anthropic.ContentBlockParam = isPdf
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      }
    : {
        type: "image",
        source: {
          type: "base64",
          media_type: file.type as (typeof IMAGE_TYPES)[number],
          data: base64,
        },
      };

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
            fileBlock,
            {
              type: "text",
              text:
                kind === "timber"
                  ? "Extract the terms of this timber sale contract. Only record what the document actually states; use null for anything absent. Dates as YYYY-MM-DD, dollar amounts as plain numbers. Classify the sale type honestly (lump sum vs pay-as-cut vs delivered-price-net) and record the harvest/cutting type when stated. Surface penalty and BMP clauses in notes. List every field you are unsure about in unsure_fields."
                  : kind === "timber_settlement"
                    ? "Extract this logger or mill timber settlement statement (it may be a phone photo or several pages; read carefully). Collapse per-load/scale-ticket detail to ONE line per product, keeping the load count and the date range of the loads. Only record what is actually shown; use null for anything absent. Dates as YYYY-MM-DD, dollar amounts as plain numbers. List every field you are unsure about in unsure_fields."
                  : kind === "payment"
                    ? "Extract what this rent payment document shows: a check image or a crop share / timber settlement sheet (it may be a phone photo; read carefully, several pages possible). Only record what is actually shown; use null for anything absent. Keep the payer name exactly as printed. Dates as YYYY-MM-DD, dollar amounts as plain numbers. Classify the document_kind honestly. List every field you are unsure about in unsure_fields."
                    : kind === "tax"
                    ? "Extract the details from this property tax statement (it may be a photo; read carefully). Only record what is actually shown; use null for anything absent. Keep the parcel number and owner name exactly as printed. Dates as YYYY-MM-DD, dollar amounts as plain numbers. List every field you are unsure about in unsure_fields."
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
