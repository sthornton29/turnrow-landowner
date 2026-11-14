import { NextResponse } from "next/server";
import { adminOnly, requireOrgApi } from "@/lib/apiAuth";
import { encryptSecret } from "@/lib/farmCrypto";
import { FarmApiError, redeemShareCode } from "@/lib/farmApi";
import { syncConnection } from "@/lib/farmSync";

// The first sync now covers two crop years (the current one and the one
// before it), so it gets more room than a single year needed.
export const maxDuration = 180;

// Redeem a farmer's one-time share code, store the minted key encrypted,
// and run the first sync (mapping suggestions included).
export async function POST(request: Request) {
  const session = await requireOrgApi();
  if (session instanceof NextResponse) return session;
  const { supabase, orgId } = session;
  // The share code works exactly once, and only an admin may save a
  // connection. Check BEFORE redeeming so a member without that right
  // cannot burn the farmer's code.
  const denied = adminOnly(session, "connect a farm");
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = String(body?.code ?? "").trim();
  if (code.length < 8) {
    return NextResponse.json({ error: "Enter the share code from your farmer." }, { status: 400 });
  }

  try {
    const { token, handshake } = await redeemShareCode(code);
    const label =
      handshake.label ||
      [handshake.operation_name, handshake.landowner_name].filter(Boolean).join(" / ") ||
      "Farm connection";

    const { data: connection, error } = await supabase
      .from("farm_connections")
      .insert({
        organization_id: orgId,
        label,
        api_key_encrypted: encryptSecret(token),
        status: "active",
        scopes: handshake.scopes,
        operation_name: handshake.operation_name,
        landowner_name: handshake.landowner_name,
        field_count: handshake.field_count,
        entities: handshake.entities ?? [],
      })
      .select("*")
      .single();
    if (error || !connection) {
      console.error("farm connect: save failed after redeem", error?.message);
      return NextResponse.json(
        {
          error:
            "The code was accepted, but the connection could not be saved here. Ask your farmer for a new code and try again; if it happens twice, use Contact support.",
        },
        { status: 500 }
      );
    }

    // First sync (also seeds the mapping suggestions). A failure here is
    // reported on the connection row rather than failing the connect.
    await syncConnection(supabase, connection);

    return NextResponse.json({ connection_id: connection.id, handshake });
  } catch (err) {
    const status = err instanceof FarmApiError ? err.status : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not redeem the code." },
      { status: status >= 400 && status < 600 ? status : 502 }
    );
  }
}
