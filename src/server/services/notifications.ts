// Customer delivery notifications over WhatsApp, via an outbox.
//
// Sent from the shop's own WhatsApp number once it's connected to the
// API; until then from the shared Chatcart number
// (WHATSAPP_PLATFORM_PHONE_ID), with the shop's name in every message.
//
// Every notification has a dedupe key ("shipment:<id>:IN_TRANSIT"), so a
// status reported ten times by ten tracking polls messages the customer
// once. Sending happens after the database write (best-effort
// immediately, and again from the cron sweep), never inside it.
import { db } from "../db.ts";
import { deliveryLine, fillTemplate, shipmentTemplate, WHATSAPP_TEMPLATES, type ShipmentSummaryInput } from "../delivery/messages.ts";
import { rands } from "../delivery/pricing.ts";
import { NOTIFY_ON } from "../delivery/status.ts";
import type { Destination, ShipmentStatus } from "../delivery/types.ts";
import { shopWhatsAppToken } from "./whatsapp-connect.ts";
import { getWhatsAppSender } from "./whatsapp-sender.ts";
import type { Prisma } from "@prisma/client";

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function shipmentSummary(shipmentId: string, now = new Date()): Promise<ShipmentSummaryInput & { tenantId: string; customerPhone: string }> {
  const shipment = await db.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: { provider: true, order: { include: { customer: true, tenant: true } } },
  });
  return {
    tenantId: shipment.tenantId,
    shopName: shipment.order.tenant.name,
    customerPhone: shipment.order.customer.phone,
    orderNumber: shipment.order.number,
    providerCode: shipment.provider.code,
    providerName: shipment.provider.name,
    status: shipment.status,
    destination: shipment.destination as unknown as Destination,
    trackingNumber: shipment.trackingNumber,
    trackingUrl: shipment.trackingUrl,
    expectedDeliveryAt: shipment.expectedDeliveryAt,
    now,
  };
}

async function enqueue(
  tenantId: string,
  toPhone: string,
  template: string,
  templateParams: string[],
  body: string,
  dedupeKey: string,
): Promise<boolean> {
  try {
    await db.outboundMessage.create({
      data: { tenantId, toPhone, template, templateParams: templateParams as Prisma.InputJsonValue, body, dedupeKey },
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false; // already notified
    throw error;
  }
}

export async function enqueueShipmentNotification(shipmentId: string, status: ShipmentStatus) {
  if (!NOTIFY_ON.includes(status)) return false;
  const summary = await shipmentSummary(shipmentId);
  const template = shipmentTemplate({ ...summary, status });
  if (!template) return false;
  // Same wording inside and outside the 24h window: the free-form text is
  // the approved template filled in.
  const body = fillTemplate(WHATSAPP_TEMPLATES[template.name]!.body, template.params);
  const created = await enqueue(
    summary.tenantId,
    summary.customerPhone,
    template.name,
    template.params,
    body,
    `shipment:${shipmentId}:${status}`,
  );
  if (created) await dispatchOutbox(summary.tenantId).catch((e) => console.error("WhatsApp dispatch failed:", e));
  return created;
}

export async function enqueueOrderNotification(tenantId: string, orderId: string, kind: "ORDER_PAID") {
  const order = await db.order.findFirstOrThrow({
    where: { id: orderId, tenantId },
    include: { customer: true, tenant: true },
  });
  const destination = order.deliveryDestination as unknown as Destination;
  const params = [order.tenant.name, rands(order.totalCents), order.number, deliveryLine(destination)];
  const created = await enqueue(
    tenantId,
    order.customer.phone,
    "order_paid",
    params,
    fillTemplate(WHATSAPP_TEMPLATES.order_paid!.body, params),
    `order:${orderId}:${kind}`,
  );

  // Seller alert, from the shared number to the seller's own WhatsApp.
  // Skipped once their own number is connected (it can't message itself;
  // they see the order in that chat instead).
  if (!order.tenant.whatsappPhoneId && order.tenant.whatsappNumber) {
    const customer = [order.customer.name, localPhone(order.customer.phone)].filter(Boolean).join(", ");
    const sellerParams = [order.number, rands(order.totalCents), customer, deliveryLine(destination)];
    await enqueue(
      tenantId,
      order.tenant.whatsappNumber,
      "seller_new_order",
      sellerParams,
      fillTemplate(WHATSAPP_TEMPLATES.seller_new_order!.body, sellerParams),
      `order:${orderId}:SELLER_ALERT`,
    );
  }
  if (created) await dispatchOutbox(tenantId).catch((e) => console.error("WhatsApp dispatch failed:", e));
  return created;
}

function localPhone(phone: string): string {
  return phone.startsWith("27") && phone.length === 11 ? `0${phone.slice(2)}` : phone;
}

/** Sends queued messages. Safe to call concurrently-ish and repeatedly. */
export async function dispatchOutbox(tenantId?: string, limit = 50, now = new Date()) {
  const queued = await db.outboundMessage.findMany({
    where: { status: "QUEUED", ...(tenantId ? { tenantId } : {}) },
    include: { tenant: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const sender = getWhatsAppSender();
  let sent = 0;
  for (const message of queued) {
    // Claim it first so two sweeps never double-send.
    const claimed = await db.outboundMessage.updateMany({ where: { id: message.id, status: "QUEUED" }, data: { status: "SENT", sentAt: now } });
    if (claimed.count === 0) continue;
    const ownNumber = message.tenant.whatsappPhoneId;
    // The 24h window only exists on a number the customer has written to;
    // the shared number always uses templates.
    const conversation = ownNumber
      ? await db.conversation.findUnique({ where: { tenantId_phone: { tenantId: message.tenantId, phone: message.toPhone } } })
      : null;
    try {
      await sender.send({
        phoneNumberId: ownNumber ?? process.env.WHATSAPP_PLATFORM_PHONE_ID ?? null,
        accessToken: ownNumber ? shopWhatsAppToken(message.tenant) : null,
        to: message.toPhone,
        body: message.body,
        template: message.template,
        templateParams: (message.templateParams as string[]) ?? [],
        withinServiceWindow: !!conversation?.lastInboundAt && now.getTime() - conversation.lastInboundAt.getTime() < SERVICE_WINDOW_MS,
      });
      sent++;
    } catch (error) {
      await db.outboundMessage.update({ where: { id: message.id }, data: { status: "FAILED", sentAt: null, error: (error as Error).message.slice(0, 500) } });
    }
  }
  return { sent };
}
