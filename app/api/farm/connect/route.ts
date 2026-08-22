import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/farmCrypto";
import { FarmApiError, redeemShareCode } from "@/lib/farmApi";
import { syncConnection } from "@/lib/farmSync";

export const maxDuration = 60;

// Redeem a farmer's one-time share code, store the minted key encrypted,
// and run the first sync (mapping suggestions included).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organization_id) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const body = await request.json();
  const code = String(body.code ?? "").trim();
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
        organization_id: profile.organization_id,
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
      return NextResponse.json(
        { error: "Connected, but could not save the connection: " + (error?.message ?? "") },
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
