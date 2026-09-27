// Customer-facing delivery copy, shared by WhatsApp replies,
// notifications and the storefront. Only provider-confirmed facts are
// rendered: no status, date or tracking number that isn't on the
// shipment record.
import { sastDate } from "./dates.ts";
import { rands } from "./pricing.ts";
import type { Destination, ShipmentStatus } from "./types.ts";

export interface ShipmentSummaryInput {
  orderNumber: string;
  providerCode: string;
  providerName: string;
  status: ShipmentStatus;
  destination: Destination;
  trackingNumber: string | null;
  trackingUrl: string | null;
  expectedDeliveryAt: Date | null;
  now: Date;
}

export function courierLabel(providerCode: string, providerName: string): string {
  if (providerCode === "PAXI") return "PAXI";
  if (providerCode === "OWN_DELIVERY") return "Seller delivery";
  if (providerCode === "SELLER_COLLECTION") return "Collect from seller";
  return providerName;
}

export function destinationLabel(destination: Destination): string {
  switch (destination.kind) {
    case "PICKUP_POINT":
      return destination.location.name;
    case "ADDRESS": {
      const a = destination.address;
      return [a.complex, a.street, a.suburb, a.city, a.postcode].filter(Boolean).join(", ");
    }
    case "SELLER_COLLECTION":
      return destination.address ? [destination.address.street, destination.address.suburb, destination.address.city].join(", ") : "Seller's address";
  }
}

const CUSTOMER_STATUS: Record<ShipmentStatus, string> = {
  PENDING: "Awaiting payment",
  READY_TO_BOOK: "Preparing your order",
  READY_FOR_REGISTRATION: "Preparing your order",
  BOOKED: "Booked with courier",
  COLLECTED: "Collected by courier",
  IN_TRANSIT: "In transit",
  READY_FOR_COLLECTION: "Ready for collection",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  EXCEPTION: "Delivery problem — the seller has been alerted",
  CANCELLED: "Cancelled",
};

export function customerStatusLabel(status: ShipmentStatus, providerCode: string): string {
  if (status === "DELIVERED" && (providerCode === "PAXI" || providerCode === "SELLER_COLLECTION")) return "Collected";
  return CUSTOMER_STATUS[status];
}

function expectedLabel(expected: Date | null, now: Date): string | null {
  if (!expected) return null;
  const day = sastDate(expected);
  if (day === sastDate(now)) return "Today";
  if (day === sastDate(new Date(now.getTime() + 86_400_000))) return "Tomorrow";
  return new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Johannesburg" }).format(expected);
}

/** The "Track" reply. */
export function renderTrackingSummary(s: ShipmentSummaryInput): string {
  const lines = [`📦 Order ${s.orderNumber}`, `Courier: ${courierLabel(s.providerCode, s.providerName)}`];
  if (s.destination.kind === "PICKUP_POINT") lines.push(`Destination: ${s.destination.location.name}`);
  lines.push(`Status: ${customerStatusLabel(s.status, s.providerCode)}`);
  const expected = s.status !== "DELIVERED" && s.status !== "CANCELLED" ? expectedLabel(s.expectedDeliveryAt, s.now) : null;
  if (expected) lines.push(`Expected: ${expected}`);
  if (s.trackingNumber) lines.push(`Tracking no: ${s.trackingNumber}`);
  if (s.trackingUrl) lines.push(s.trackingUrl);

  const pickup = s.destination.kind === "PICKUP_POINT";
  if (pickup && !["READY_FOR_COLLECTION", "DELIVERED", "CANCELLED"].includes(s.status)) {
    lines.push("", "We'll message you when it is ready for collection.");
  } else if (!pickup && !["DELIVERED", "CANCELLED", "EXCEPTION"].includes(s.status)) {
    lines.push("", "We'll message you as your parcel moves.");
  }
  return lines.join("\n");
}

/** Proactive notification text for a shipment status change. */
export function renderStatusNotification(s: ShipmentSummaryInput): string | null {
  const courier = courierLabel(s.providerCode, s.providerName);
  const where = s.destination.kind === "PICKUP_POINT" ? s.destination.location.name : null;
  const ref = s.trackingNumber ? `\nTracking no: ${s.trackingNumber}` : "";
  const link = s.trackingUrl ? `\n${s.trackingUrl}` : "";
  switch (s.status) {
    case "BOOKED":
      return `📦 Order ${s.orderNumber} is booked with ${courier}.${ref}${link}`;
    case "COLLECTED":
      return `🚚 Order ${s.orderNumber} is on its way — ${courier} has your parcel.${ref}`;
    case "IN_TRANSIT":
      return `🚚 Order ${s.orderNumber} is in transit${where ? ` to ${where}` : ""}.${ref}`;
    case "READY_FOR_COLLECTION":
      return where
        ? `🎉 Order ${s.orderNumber} is ready for collection at ${where}. Take your ID and this order number with you.${ref}`
        : `🎉 Order ${s.orderNumber} is ready for collection.`;
    case "OUT_FOR_DELIVERY":
      return `🛵 Order ${s.orderNumber} is out for delivery today.${ref}`;
    case "DELIVERED":
      return where || s.providerCode === "SELLER_COLLECTION"
        ? `✅ Order ${s.orderNumber} has been collected. Enjoy!`
        : `✅ Order ${s.orderNumber} has been delivered. Enjoy!`;
    case "EXCEPTION":
      return `⚠️ There's a delivery problem with order ${s.orderNumber}. The seller has been alerted and will contact you.${ref}`;
    default:
      return null;
  }
}

export function renderOrderPaid(orderNumber: string, totalCents: number, deliveryLine: string): string {
  return `✅ Payment of ${rands(totalCents)} received for order ${orderNumber}.\n${deliveryLine}\nWe'll let you know when it ships.`;
}
