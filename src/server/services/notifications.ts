// Customer delivery notifications over WhatsApp, via an outbox.
//
// Every notification has a dedupe key ("shipment:<id>:IN_TRANSIT"), so a
// status reported ten times by ten tracking polls messages the customer
// once. Sending happens after the database write (best-effort
// immediately, and again from the cron sweep), never inside it.
import { db } from "../db.ts";
import { destinationLabel, renderOrderPaid, renderStatusNotification, type ShipmentSummaryInput } from "../delivery/messages.ts";
import { NOTIFY_ON } from "../delivery/status.ts";
import type { Destination, ShipmentStatus } from "../delivery/types.ts";
import { getWhatsAppSender } from "./whatsapp-sender.ts";
import type { Prisma } from "@prisma/client";

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function shipmentSummary(shipmentId: string, now = new Date()): Promise<ShipmentSummaryInput & { tenantId: string; customerPhone: string }> {
  const shipment = await db.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: { provider: true, order: { include: { customer: true } } },
  });
  return {
    tenantId: shipment.tenantId,
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
  const body = renderStatusNotification({ ...summary, status });
  if (!body) return false;
  const created = await enqueue(
    summary.tenantId,
    summary.customerPhone,
    `shipment_${status.toLowerCase()}`,
    [summary.orderNumber, destinationLabel(summary.destination), summary.trackingNumber ?? "-"],
    body,
    `shipment:${shipmentId}:${status}`,
  );
  if (created) await dispatchOutbox(summary.tenantId).catch((e) => console.error("WhatsApp dispatch failed:", e));
  return created;
}

export async function enqueueOrderNotification(tenantId: string, orderId: string, kind: "ORDER_PAID") {
  const order = await db.order.findFirstOrThrow({
    where: { id: orderId, tenantId },
    include: { customer: true, deliveryProvider: true },
  });
  const destination = order.deliveryDestination as unknown as Destination;
  const deliveryLine =
    destination.kind === "PICKUP_POINT"
      ? `Collecting at: ${destination.location.name}`
      : destination.kind === "SELLER_COLLECTION"
        ? "Collecting from the seller — we'll tell you when it's ready."
        : `Delivering to: ${destinationLabel(destination)}`;
  const created = await enqueue(
    tenantId,
    order.customer.phone,
    "order_paid",
    [order.number, (order.totalCents / 100).toFixed(2), destinationLabel(destination)],
    renderOrderPaid(order.number, order.totalCents, deliveryLine),
    `order:${orderId}:${kind}`,
  );
  if (created) await dispatchOutbox(tenantId).catch((e) => console.error("WhatsApp dispatch failed:", e));
  return created;
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
    const conversation = await db.conversation.findUnique({ where: { tenantId_phone: { tenantId: message.tenantId, phone: message.toPhone } } });
    try {
      await sender.send({
        phoneNumberId: message.tenant.whatsappPhoneId,
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
