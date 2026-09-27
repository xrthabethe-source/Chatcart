// Seller order dashboard + shipment lifecycle + tracking sync.
//
// Every status change — from a courier API poll, a seller entering a
// PAXI reference, or a seller marking an own-delivery as delivered —
// goes through `applyTracking`, which records deduplicated events, only
// ever moves a shipment forward, keeps the order status in step, and
// queues the customer notification.
import { z } from "zod";
import { db } from "../db.ts";
import { destinationLabel } from "../delivery/messages.ts";
import { getDeliveryAdapter } from "../delivery/registry.ts";
import { advanceStatus, isTerminal, SELLER_SETTABLE, STATUS_LABELS } from "../delivery/status.ts";
import {
  ProviderNotSupportedError,
  ProviderUnavailableError,
  type Destination,
  type ShipmentStatus,
  type TrackingEvent,
} from "../delivery/types.ts";
import type { AuthenticatedUser } from "./auth.ts";
import { dispatchAddress, providerContext } from "./delivery-settings.ts";
import { ConflictError, DeliveryUnavailableError, NotFoundError, ValidationError, zodMessage } from "./errors.ts";
import { enqueueShipmentNotification } from "./notifications.ts";
import type { OrderStatus, Prisma } from "@prisma/client";

const shipmentInclude = {
  provider: true,
  events: { orderBy: { occurredAt: "desc" } },
  order: { include: { customer: true, items: true, tenant: true } },
} satisfies Prisma.ShipmentInclude;
type ShipmentFull = Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>;

// ─── Queries ─────────────────────────────────────────────────────────

export const orderFilterSchema = z.object({
  status: z.enum(["PENDING_PAYMENT", "PAID", "FULFILLING", "SHIPPED", "READY_FOR_COLLECTION", "COMPLETED", "CANCELLED"]).optional(),
  shipmentStatus: z.string().optional(),
});

export async function listOrders(user: AuthenticatedUser, filter: z.input<typeof orderFilterSchema> = {}) {
  const f = orderFilterSchema.parse(filter);
  return db.order.findMany({
    where: {
      tenantId: user.tenantId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.shipmentStatus ? { shipments: { some: { status: f.shipmentStatus as ShipmentStatus } } } : {}),
    },
    include: { customer: true, deliveryProvider: true, shipments: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getOrderDetail(user: AuthenticatedUser, orderId: string) {
  const order = await db.order.findFirst({
    where: { id: orderId, tenantId: user.tenantId },
    include: {
      customer: true,
      items: true,
      deliveryProvider: true,
      shipments: { include: { provider: true, events: { orderBy: { occurredAt: "desc" } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) throw new NotFoundError("Order");
  return {
    ...order,
    destination: order.deliveryDestination as unknown as Destination,
    shipments: order.shipments.map((s) => ({ ...s, actions: shipmentActions(s) })),
  };
}

export interface ShipmentActions {
  createShipment: boolean;
  enterTrackingReference: boolean;
  printLabel: boolean;
  trackParcel: boolean;
  cancel: boolean;
  setStatus: ShipmentStatus[];
}

export function shipmentActions(s: {
  status: ShipmentStatus;
  mode: "INTEGRATED" | "ASSISTED";
  labelUrl: string | null;
  trackingNumber: string | null;
  provider: { code: string; name: string };
  destination: unknown;
}): ShipmentActions {
  const selfFulfilled = s.provider.code === "OWN_DELIVERY" || s.provider.code === "SELLER_COLLECTION";
  const bookable = s.mode === "INTEGRATED" && !selfFulfilled;
  const paid = s.status !== "PENDING";
  const done = isTerminal(s.status);
  return {
    createShipment: bookable && s.status === "READY_TO_BOOK",
    enterTrackingReference: !bookable && !selfFulfilled && paid && !done && !s.trackingNumber,
    printLabel: !!s.labelUrl,
    trackParcel: bookable && !!s.trackingNumber && !done,
    // Assisted parcels already registered on the provider portal must be
    // cancelled there too; the dashboard says so next to the button.
    cancel: !done && paid,
    // Assisted and self-fulfilled shipments are progressed by the seller;
    // integrated ones only by the courier's own tracking.
    setStatus:
      !bookable && paid && !done && (selfFulfilled || !!s.trackingNumber)
        ? SELLER_SETTABLE.filter((st) => st !== s.status && relevantFor((s.destination as Destination).kind, st))
        : [],
  };
}

// "Out for delivery" means nothing for a PAXI pickup, nor "ready for
// collection" for a door delivery.
function relevantFor(kind: Destination["kind"], status: ShipmentStatus): boolean {
  if (kind === "PICKUP_POINT") return status !== "OUT_FOR_DELIVERY";
  if (kind === "ADDRESS") return status !== "READY_FOR_COLLECTION";
  return status === "READY_FOR_COLLECTION" || status === "DELIVERED" || status === "EXCEPTION";
}

async function loadShipment(user: AuthenticatedUser, shipmentId: string): Promise<ShipmentFull> {
  const shipment = await db.shipment.findFirst({ where: { id: shipmentId, tenantId: user.tenantId }, include: shipmentInclude });
  if (!shipment) throw new NotFoundError("Shipment");
  return shipment;
}

async function tenantProvider(tenantId: string, providerId: string) {
  const row = await db.tenantDeliveryProvider.findFirst({ where: { tenantId, providerId }, include: { provider: true } });
  if (!row) throw new DeliveryUnavailableError("This courier is not configured for your shop.");
  return row;
}

// ─── Status application ──────────────────────────────────────────────

const ORDER_STATUS_FOR: Partial<Record<ShipmentStatus, OrderStatus>> = {
  BOOKED: "SHIPPED",
  COLLECTED: "SHIPPED",
  IN_TRANSIT: "SHIPPED",
  OUT_FOR_DELIVERY: "SHIPPED",
  READY_FOR_COLLECTION: "READY_FOR_COLLECTION",
  DELIVERED: "COMPLETED",
};

export async function applyTracking(
  shipmentId: string,
  update: { status: ShipmentStatus; events: TrackingEvent[]; source: "PROVIDER" | "SELLER" | "SYSTEM"; expectedDeliveryAt?: Date | null },
) {
  const { before, after } = await db.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    for (const e of update.events) {
      await tx.shipmentEvent.upsert({
        where: { shipmentId_dedupeKey: { shipmentId, dedupeKey: e.dedupeKey } },
        update: {},
        create: {
          shipmentId,
          status: e.status,
          description: e.description,
          location: e.location ?? null,
          occurredAt: e.occurredAt,
          source: update.source,
          dedupeKey: e.dedupeKey,
        },
      });
    }
    const next = advanceStatus(shipment.status, update.status);
    const updated = await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status: next,
        lastTrackedAt: update.source === "PROVIDER" ? new Date() : shipment.lastTrackedAt,
        deliveredAt: next === "DELIVERED" && !shipment.deliveredAt ? new Date() : shipment.deliveredAt,
        ...(update.expectedDeliveryAt !== undefined && update.expectedDeliveryAt !== null ? { expectedDeliveryAt: update.expectedDeliveryAt } : {}),
      },
    });
    const orderStatus = ORDER_STATUS_FOR[next];
    if (orderStatus && next !== shipment.status) {
      await tx.order.update({ where: { id: shipment.orderId }, data: { status: orderStatus } });
    }
    return { before: shipment.status, after: updated.status };
  });

  if (after !== before) await enqueueShipmentNotification(shipmentId, after);
  return { before, after };
}

// ─── Seller actions ──────────────────────────────────────────────────

/** BOOK DELIVERY / CREATE SHIPMENT (integrated providers). */
export async function createShipment(user: AuthenticatedUser, shipmentId: string) {
  const shipment = await loadShipment(user, shipmentId);
  if (!shipmentActions(shipment).createShipment) {
    throw new ConflictError(`This shipment can't be booked automatically (status: ${STATUS_LABELS[shipment.status]}).`);
  }
  const row = await tenantProvider(user.tenantId, shipment.providerId);
  const adapter = getDeliveryAdapter(row.provider.code, row.provider.name);
  const origin = dispatchAddress(row);
  const order = shipment.order;

  let created;
  try {
    created = await adapter.createShipment(providerContext(row), {
      orderNumber: order.number,
      serviceCode: shipment.serviceCode,
      origin,
      sender: { name: row.dispatchContactName ?? order.tenant.name, phone: row.dispatchContactPhone ?? "" },
      destination: shipment.destination as unknown as Destination,
      recipient: { name: order.customer.name ?? "Customer", phone: order.customer.phone, email: order.customer.email },
      parcel: {
        lengthCm: shipment.parcelLengthCm,
        widthCm: shipment.parcelWidthCm,
        heightCm: shipment.parcelHeightCm,
        weightGrams: shipment.parcelWeightGrams,
      },
      declaredValueCents: order.subtotalCents,
      readyAt: new Date(),
      quoteProviderData: ((shipment.providerData as { quote?: Record<string, unknown> })?.quote ?? {}) as Record<string, unknown>,
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError || error instanceof ProviderNotSupportedError) throw new DeliveryUnavailableError(error.message);
    throw error;
  }

  await db.shipment.update({
    where: { id: shipmentId },
    data: {
      trackingNumber: created.trackingNumber,
      trackingUrl: created.trackingUrl,
      providerShipmentRef: created.providerShipmentRef,
      labelUrl: created.labelUrl,
      expectedDeliveryAt: created.expectedDeliveryAt,
      bookedAt: new Date(),
      providerData: { ...((shipment.providerData as object) ?? {}), booking: created.providerData ?? {} } as Prisma.InputJsonValue,
    },
  });
  await applyTracking(shipmentId, {
    status: "BOOKED",
    source: "SYSTEM",
    events: [{ status: "BOOKED", description: `Booked with ${row.provider.name}`, occurredAt: new Date(), dedupeKey: "booked" }],
  });
  return getOrderDetail(user, order.id);
}

export const trackingReferenceSchema = z.object({
  trackingNumber: z.string().trim().min(3, "Enter the tracking/reference number.").max(60),
  trackingUrl: z.string().trim().url().nullable().optional(),
});

/** Assisted mode: seller registered the parcel on the PAXI portal. */
export async function enterTrackingReference(user: AuthenticatedUser, shipmentId: string, input: z.input<typeof trackingReferenceSchema>) {
  const parsed = trackingReferenceSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const shipment = await loadShipment(user, shipmentId);
  if (!shipmentActions(shipment).enterTrackingReference) throw new ConflictError("A tracking reference can't be added to this shipment.");

  const row = await tenantProvider(user.tenantId, shipment.providerId);
  const adapter = getDeliveryAdapter(row.provider.code, row.provider.name);
  const ref = { trackingNumber: parsed.data.trackingNumber, providerShipmentRef: null };
  await db.shipment.update({
    where: { id: shipmentId },
    data: {
      trackingNumber: parsed.data.trackingNumber,
      trackingUrl: parsed.data.trackingUrl ?? adapter.getTrackingUrl(providerContext(row), ref),
      bookedAt: new Date(),
    },
  });
  await applyTracking(shipmentId, {
    status: "BOOKED",
    source: "SELLER",
    events: [{ status: "BOOKED", description: `Registered with ${row.provider.name} (${parsed.data.trackingNumber})`, occurredAt: new Date(), dedupeKey: "booked" }],
  });
  return getOrderDetail(user, shipment.orderId);
}

export const manualStatusSchema = z.object({
  status: z.enum(["COLLECTED", "IN_TRANSIT", "READY_FOR_COLLECTION", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION"]),
  note: z.string().trim().max(300).optional(),
});

/** Assisted / own-delivery / collection: the seller reports progress. */
export async function setShipmentStatus(user: AuthenticatedUser, shipmentId: string, input: z.input<typeof manualStatusSchema>) {
  const parsed = manualStatusSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const shipment = await loadShipment(user, shipmentId);
  if (!shipmentActions(shipment).setStatus.includes(parsed.data.status)) {
    throw new ConflictError("This status can't be set by hand for this shipment.");
  }
  const now = new Date();
  await applyTracking(shipmentId, {
    status: parsed.data.status,
    source: "SELLER",
    events: [
      {
        status: parsed.data.status,
        description: parsed.data.note || STATUS_LABELS[parsed.data.status],
        occurredAt: now,
        dedupeKey: `seller:${parsed.data.status}:${now.toISOString()}`,
      },
    ],
  });
  return getOrderDetail(user, shipment.orderId);
}

export async function cancelShipment(user: AuthenticatedUser, shipmentId: string) {
  const shipment = await loadShipment(user, shipmentId);
  if (isTerminal(shipment.status)) throw new ConflictError("This shipment is already finished.");
  if (shipment.mode === "INTEGRATED" && (shipment.trackingNumber || shipment.providerShipmentRef)) {
    const row = await tenantProvider(user.tenantId, shipment.providerId);
    try {
      await getDeliveryAdapter(row.provider.code, row.provider.name).cancelShipment(providerContext(row), {
        trackingNumber: shipment.trackingNumber,
        providerShipmentRef: shipment.providerShipmentRef,
      });
    } catch (error) {
      if (error instanceof ProviderUnavailableError || error instanceof ProviderNotSupportedError) throw new DeliveryUnavailableError(error.message);
      throw error;
    }
  }
  await applyTracking(shipmentId, {
    status: "CANCELLED",
    source: "SELLER",
    events: [{ status: "CANCELLED", description: "Shipment cancelled by seller", occurredAt: new Date(), dedupeKey: "cancelled" }],
  });
  return getOrderDetail(user, shipment.orderId);
}

// ─── Tracking sync ───────────────────────────────────────────────────

/** TRACK PARCEL: pull the latest provider-confirmed tracking. */
export async function refreshTracking(shipmentId: string) {
  const shipment = await db.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { provider: true } });
  if (shipment.mode !== "INTEGRATED" || !shipment.trackingNumber || isTerminal(shipment.status)) return null;
  const row = await tenantProvider(shipment.tenantId, shipment.providerId);
  const adapter = getDeliveryAdapter(row.provider.code, row.provider.name);
  const result = await adapter.getTracking(providerContext(row), {
    trackingNumber: shipment.trackingNumber,
    providerShipmentRef: shipment.providerShipmentRef,
  });
  return applyTracking(shipmentId, { status: result.status, events: result.events, source: "PROVIDER", expectedDeliveryAt: result.expectedDeliveryAt });
}

export async function refreshTrackingForSeller(user: AuthenticatedUser, shipmentId: string) {
  const shipment = await loadShipment(user, shipmentId);
  try {
    await refreshTracking(shipment.id);
  } catch (error) {
    if (error instanceof ProviderUnavailableError || error instanceof ProviderNotSupportedError) throw new DeliveryUnavailableError(error.message);
    throw error;
  }
  return getOrderDetail(user, shipment.orderId);
}

/** Cron sweep: refresh every active integrated shipment. */
export async function syncAllTracking(limit = 200) {
  const active = await db.shipment.findMany({
    where: { mode: "INTEGRATED", trackingNumber: { not: null }, status: { notIn: ["DELIVERED", "CANCELLED", "PENDING"] } },
    orderBy: { lastTrackedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true },
  });
  let updated = 0;
  let failed = 0;
  for (const { id } of active) {
    try {
      const result = await refreshTracking(id);
      if (result && result.after !== result.before) updated++;
    } catch (error) {
      failed++;
      console.error(`Tracking refresh failed for shipment ${id}:`, error);
    }
  }
  return { checked: active.length, updated, failed };
}

// ─── COPY SHIPPING DETAILS / PAXI registration export ────────────────

export async function shippingDetailsText(user: AuthenticatedUser, shipmentId: string): Promise<string> {
  const s = await loadShipment(user, shipmentId);
  const d = s.destination as unknown as Destination;
  const c = s.order.customer;
  const lines = [
    `Order: ${s.order.number}`,
    `Recipient: ${c.name ?? "Customer"}`,
    `Mobile: ${localPhone(c.phone)}`,
    ...(c.email ? [`Email: ${c.email}`] : []),
  ];
  if (d.kind === "PICKUP_POINT") {
    lines.push(
      `${s.provider.code === "PAXI" ? "PAXI Point" : "Pickup point"}: ${d.location.name}`,
      ...(d.location.code ? [`Point code: ${d.location.code}`] : []),
      `Location ID: ${d.location.externalId}`,
      ...(d.location.address ? [`Address: ${d.location.address}`] : []),
      `Area: ${[d.location.suburb, d.location.city, d.location.province, d.location.postcode].filter(Boolean).join(", ")}`,
    );
  } else {
    lines.push(`Deliver to: ${destinationLabel(d)}`);
  }
  lines.push(
    `Service: ${s.serviceCode}`,
    `Parcel: ${s.parcelLengthCm} x ${s.parcelWidthCm} x ${s.parcelHeightCm} cm, ${(s.parcelWeightGrams / 1000).toFixed(2)} kg`,
    `Declared value: R${(s.order.subtotalCents / 100).toFixed(2)}`,
  );
  return lines.join("\n");
}

function localPhone(phone: string): string {
  return phone.startsWith("27") && phone.length === 11 ? `0${phone.slice(2)}` : phone;
}

function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  // Spreadsheet formula injection guard.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of every paid PAXI parcel still waiting to be registered. */
export async function exportPaxiRegistrationCsv(user: AuthenticatedUser): Promise<string> {
  const shipments = await db.shipment.findMany({
    where: { tenantId: user.tenantId, status: "READY_FOR_REGISTRATION" },
    include: { order: { include: { customer: true } } },
    orderBy: { createdAt: "asc" },
  });
  const header = [
    "order_number", "recipient_name", "recipient_mobile", "recipient_email",
    "paxi_point_name", "paxi_point_code", "paxi_location_id", "point_address", "suburb", "city", "province", "postcode",
    "service", "length_cm", "width_cm", "height_cm", "weight_kg", "declared_value",
  ];
  const rows = shipments.map((s) => {
    const d = s.destination as unknown as Destination;
    const loc = d.kind === "PICKUP_POINT" ? d.location : null;
    return [
      s.order.number, s.order.customer.name, localPhone(s.order.customer.phone), s.order.customer.email,
      loc?.name, loc?.code, loc?.externalId, loc?.address, loc?.suburb, loc?.city, loc?.province, loc?.postcode,
      s.serviceCode, s.parcelLengthCm, s.parcelWidthCm, s.parcelHeightCm, (s.parcelWeightGrams / 1000).toFixed(2),
      (s.order.subtotalCents / 100).toFixed(2),
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...rows].join("\n") + "\n";
}
