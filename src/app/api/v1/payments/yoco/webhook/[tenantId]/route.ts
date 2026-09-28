import { NextRequest, NextResponse } from "next/server";
import { handle } from "@/server/http/respond";
import { handleYocoWebhook } from "@/server/services/payments";

// Yoco → Chatcart, one URL per shop (registered when the seller connects
// Yoco). The raw body is needed to check the signature.
export const POST = handle(async (request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) => {
  const { tenantId } = await params;
  const raw = await request.text();
  const result = await handleYocoWebhook(
    tenantId,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    raw,
  );
  return NextResponse.json(result);
});
