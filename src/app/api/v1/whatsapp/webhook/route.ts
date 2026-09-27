import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { handleWhatsAppMessage, type InboundMessage } from "@/server/services/whatsapp-flow";
import { getWhatsAppSender } from "@/server/services/whatsapp-sender";

// Meta Cloud API webhook.
// GET  — one-time verification handshake (WHATSAPP_META_VERIFY_TOKEN).
// POST — inbound messages, verified with X-Hub-Signature-256 against
//        WHATSAPP_META_APP_SECRET, routed to the shop that owns the
//        receiving phone_number_id.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const token = process.env.WHATSAPP_META_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_META_APP_SECRET;
  if (!secret) return process.env.APP_ENV === "development"; // local testing only
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

interface MetaMessage {
  from: string;
  type: string;
  text?: { body: string };
  interactive?: { button_reply?: { id: string }; list_reply?: { id: string } };
  button?: { text: string };
  location?: { latitude: number; longitude: number };
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) return new Response("Invalid signature", { status: 401 });

  let payload: { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; contacts?: { profile?: { name?: string } }[]; messages?: MetaMessage[] } }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const sender = getWhatsAppSender();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId || !value?.messages?.length) continue; // e.g. delivery receipts
      const tenant = await db.tenant.findUnique({ where: { whatsappPhoneId: phoneNumberId } });
      if (!tenant) continue;
      for (const m of value.messages) {
        const inbound: InboundMessage = {
          phone: m.from,
          profileName: value.contacts?.[0]?.profile?.name ?? null,
          text: m.text?.body ?? m.button?.text ?? null,
          optionId: m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null,
          location: m.location ? { latitude: m.location.latitude, longitude: m.location.longitude } : null,
        };
        try {
          const reply = await handleWhatsAppMessage(tenant.id, inbound);
          await sender.send({ phoneNumberId, to: m.from, body: reply.text, template: "", templateParams: [], withinServiceWindow: true });
        } catch (error) {
          console.error("WhatsApp message handling failed:", error);
        }
      }
    }
  }
  // Always 200 once verified, so Meta doesn't retry messages we've handled.
  return NextResponse.json({ ok: true });
}
