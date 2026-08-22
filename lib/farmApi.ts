// Server-side client for the Turnrow farm software partner API (see
// grain-tracker/docs/PARTNER_API.md). All calls run in server routes only;
// bearer tokens never reach the browser.

const TIMEOUT_MS = 15000;

export class FarmApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
  get isRevoked() {
    return this.status === 403 && this.code === "share_revoked";
  }
  get isScopeOff() {
    return this.status === 403 && this.code === "not_in_share_scope";
  }
}

export interface FarmScopes {
  fields: boolean;
  plantings: boolean;
  harvest: boolean;
  yields: boolean;
  // Opt-in, default OFF on the farm side.
  projected_prices?: boolean;
  projected_yields?: boolean;
}

// A farming entity behind the shared fields (operating entities section
// of PARTNER_API.md). Key on id, never on the name: farmers rename.
export interface FarmEntity {
  id: string;
  name: string;
  field_count?: number | null;
}

export interface FarmHandshake {
  operation_name: string;
  landowner_name: string | null;
  label?: string | null;
  scopes: FarmScopes;
  field_count: number;
  api_version: string;
  // Absent on a pre-entity farm API.
  entities?: FarmEntity[] | null;
}

// One aggregate number per crop by design (no components, no bushel
// quantities; the tenant's marketing position cannot be reconstructed).
export interface RemoteMarketingPrice {
  crop: string;
  crop_year: number;
  unit: "usd_per_bu" | "cents_per_lb";
  projected_avg_price: number | null;
  is_final: boolean;
  as_of: string;
}

// by_entity[] rows: the same shape per farming entity. A crop the API
// cannot compute for an entity is omitted (whereas data[] carries null).
export interface RemoteEntityMarketingPrice extends RemoteMarketingPrice {
  entity_id: string;
  entity_name: string | null;
}

export interface RemoteProjectedYield {
  field_id: string;
  field_name: string | null;
  crop: string;
  crop_year: number;
  planted_acres: number | null;
  yield_per_acre: number | null;
  unit: "bu_per_ac" | "lbs_per_ac" | null;
  basis: "expected" | "actual";
  practices: Array<{ practice: string; acres: number; yield_per_acre: number }> | null;
  entity_id?: string | null;
}

export interface RemoteField {
  id: string;
  name: string;
  farm_name: string | null;
  farm_code: string | null;
  entity: string | null;
  entity_id?: string | null;
  acres: { total: number | null; irrigated: number | null; dryland: number | null };
}

export interface RemotePlanting {
  id: string;
  field_id: string;
  field_name: string | null;
  crop: string | null;
  crop_year: number;
  planted_acres: number;
  irrigated_acres: number | null;
  dryland_acres: number | null;
  planting_date: string | null;
  varieties: Array<{ variety: string; acres: number }>;
  entity_id?: string | null;
  entity?: string | null;
}

export interface RemoteProduction {
  field_id: string;
  crop: string | null;
  crop_year: number;
  planted_acres: number | null;
  harvested_acres: number | null;
  production_units: number | null; // null when yields are not shared
  unit: "bu" | "lbs" | null;
  entity_id?: string | null;
  entity?: string | null;
}

function baseUrl(): string {
  const url = process.env.FARM_API_BASE_URL;
  if (!url) {
    throw new FarmApiError(
      "FARM_API_BASE_URL is not configured on the server.",
      500
    );
  }
  return url.replace(/\/+$/, "");
}

async function farmFetch<T>(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new FarmApiError(
        "The farm software did not respond within 15 seconds. Your saved data is still shown; try again later.",
        504
      );
    }
    throw new FarmApiError("Could not reach the farm software.", 502);
  }
  clearTimeout(timer);

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    if (response.ok) throw new FarmApiError("Unreadable response from the farm software.", 502);
  }
  if (!response.ok) {
    throw new FarmApiError(
      String(body.error ?? `Farm API error (HTTP ${response.status})`),
      response.status,
      body.code ? String(body.code) : null
    );
  }
  return body as T;
}

export function redeemShareCode(code: string) {
  return farmFetch<{ token: string; handshake: FarmHandshake }>("/shares/redeem", {
    method: "POST",
    body: { code },
  });
}

export function getHandshake(token: string) {
  return farmFetch<FarmHandshake>("/handshake", { token });
}

export async function getFields(token: string): Promise<RemoteField[]> {
  const body = await farmFetch<{ data: RemoteField[] }>("/fields", { token });
  return body.data ?? [];
}

export async function getPlantings(token: string, year: number): Promise<RemotePlanting[]> {
  const body = await farmFetch<{ data: RemotePlanting[] }>(`/plantings?year=${year}`, { token });
  return body.data ?? [];
}

export async function getProduction(token: string, year: number): Promise<RemoteProduction[]> {
  const body = await farmFetch<{ data: RemoteProduction[] }>(`/production?year=${year}`, { token });
  return body.data ?? [];
}

export async function getMarketingPrices(
  token: string,
  year: number
): Promise<{ data: RemoteMarketingPrice[]; by_entity: RemoteEntityMarketingPrice[] }> {
  const body = await farmFetch<{ data: RemoteMarketingPrice[]; by_entity?: RemoteEntityMarketingPrice[] | null }>(
    `/marketing-prices?year=${year}`,
    { token }
  );
  return { data: body.data ?? [], by_entity: body.by_entity ?? [] };
}

export async function getProjectedYields(
  token: string,
  year: number
): Promise<RemoteProjectedYield[]> {
  const body = await farmFetch<{ data: RemoteProjectedYield[] }>(
    `/projected-yields?year=${year}`,
    { token }
  );
  return body.data ?? [];
}
