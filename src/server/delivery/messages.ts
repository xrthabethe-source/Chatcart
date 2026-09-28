// Customer-facing delivery copy, shared by WhatsApp replies,
// notifications and the storefront. Only provider-confirmed facts are
// rendered: no status, date or tracking number that isn't on the
// shipment record.
import { sastDate } from "./dates.ts";
import type { Destination, ShipmentStatus } from "./types.ts";

export interface ShipmentSummaryInput {
  shopName: string;
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

// ─── Approved WhatsApp templates ──────────────────────────────────────
// Business-initiated messages (outside the 24h window) must use templates
// pre-approved by Meta. Each entry's `params` fill {{1}}, {{2}}… in order,
// and `body` is the exact text to submit — docs/whatsapp-templates.md is
// generated from this list, so code and approved text can't drift apart.

export interface TemplateSpec {
  name: string;
  body: string;
  example: string[];
}

// {{1}} is always the shop name: until a seller connects their own
// number, customers get these from the shared Chatcart number, so each
// message says which shop it's about.
export const WHATSAPP_TEMPLATES: Record<string, TemplateSpec> = {
  order_paid: {
    name: "order_paid",
    body: "✅ {{1}}: payment of {{2}} received for order {{3}}.\nDelivery: {{4}}\nWe'll let you know when it ships.",
    example: ["Sandile's Shop", "R859.95", "SHS-1048", "Collect at PEP Jabulani Mall"],
  },
  shipment_booked: {
    name: "shipment_booked",
    body: "📦 {{1}}: order {{2}} is booked with {{3}}.\nTracking no: {{4}}\nReply TRACK any time for an update.",
    example: ["Sandile's Shop", "SHS-1048", "PAXI", "PX-778812"],
  },
  shipment_collected: {
    name: "shipment_collected",
    body: "🚚 {{1}}: order {{2}} is on its way. {{3}} has your parcel.\nReply TRACK any time for an update.",
    example: ["Sandile's Shop", "SHS-1048", "The Courier Guy"],
  },
  shipment_in_transit: {
    name: "shipment_in_transit",
    body: "🚚 {{1}}: order {{2}} is in transit to {{3}}.\nReply TRACK any time for an update.",
    example: ["Sandile's Shop", "SHS-1048", "PEP Jabulani Mall"],
  },
  shipment_ready_for_collection: {
    name: "shipment_ready_for_collection",
    body: "🎉 {{1}}: order {{2}} is ready for collection at {{3}}. Take your ID and this order number with you.",
    example: ["Sandile's Shop", "SHS-1048", "PEP Jabulani Mall"],
  },
  shipment_out_for_delivery: {
    name: "shipment_out_for_delivery",
    body: "🛵 {{1}}: order {{2}} is out for delivery today.\nReply TRACK any time for an update.",
    example: ["Sandile's Shop", "SHS-1049"],
  },
  shipment_delivered: {
    name: "shipment_delivered",
    body: "✅ {{1}}: order {{2}} has been delivered or collected. Enjoy!",
    example: ["Sandile's Shop", "SHS-1048"],
  },
  shipment_exception: {
    name: "shipment_exception",
    body: "⚠️ {{1}}: there's a delivery problem with order {{2}}. The seller has been alerted and will contact you.",
    example: ["Sandile's Shop", "SHS-1048"],
  },
  // To the seller, from the shared Chatcart number.
  seller_new_order: {
    name: "seller_new_order",
    body: "🛒 New paid order {{1}} for {{2}}.\nCustomer: {{3}}\nDelivery: {{4}}\nOpen Chatcart to ship it.",
    example: ["SHS-1048", "R859.95", "Thandi Nkosi, 082 123 4567", "Collect at PEP Jabulani Mall"],
  },
};

/** Template name + ordered parameters for a shipment status notification. */
export function shipmentTemplate(s: ShipmentSummaryInput): { name: string; params: string[] } | null {
  const shop = s.shopName;
  const courier = courierLabel(s.providerCode, s.providerName);
  const where = s.destination.kind === "PICKUP_POINT" ? s.destination.location.name : destinationLabel(s.destination);
  switch (s.status) {
    case "BOOKED":
      return { name: "shipment_booked", params: [shop, s.orderNumber, courier, s.trackingNumber ?? "to follow"] };
    case "COLLECTED":
      return { name: "shipment_collected", params: [shop, s.orderNumber, courier] };
    case "IN_TRANSIT":
      return { name: "shipment_in_transit", params: [shop, s.orderNumber, where] };
    case "READY_FOR_COLLECTION":
      return { name: "shipment_ready_for_collection", params: [shop, s.orderNumber, where] };
    case "OUT_FOR_DELIVERY":
      return { name: "shipment_out_for_delivery", params: [shop, s.orderNumber] };
    case "DELIVERED":
      return { name: "shipment_delivered", params: [shop, s.orderNumber] };
    case "EXCEPTION":
      return { name: "shipment_exception", params: [shop, s.orderNumber] };
    default:
      return null;
  }
}

/** One-line delivery description used in order messages. */
export function deliveryLine(destination: Destination): string {
  if (destination.kind === "PICKUP_POINT") return `Collect at ${destination.location.name}`;
  if (destination.kind === "SELLER_COLLECTION") return "Collect from the seller";
  return `Deliver to ${destinationLabel(destination)}`;
}

/** Fills a template body with its parameters (used by tests and docs). */
export function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");
}
