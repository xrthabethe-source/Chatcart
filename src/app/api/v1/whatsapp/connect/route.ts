import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { completeEmbeddedSignup, disconnectWhatsApp, getWhatsAppConnection } from "@/server/services/whatsapp-connect";

export const GET = handle(async () => NextResponse.json({ whatsapp: await getWhatsAppConnection(await requireCurrentUser(), true) }));

// Finish Embedded Signup: { code, wabaId, phoneNumberId, coexistence }.
export const POST = handle(async (request: NextRequest) =>
  NextResponse.json({ whatsapp: await completeEmbeddedSignup(await requireCurrentUser(), await request.json()) }),
);

export const DELETE = handle(async () => NextResponse.json({ whatsapp: await disconnectWhatsApp(await requireCurrentUser()) }));
