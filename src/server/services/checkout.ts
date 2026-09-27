// Channel-agnostic checkout: the web storefront and the WhatsApp flow
// both drive exactly these functions, so "How would you like to receive
// your order?" behaves identically everywhere, and identically whether a
// provider is running INTEGRATED or ASSISTED behind the scenes.
//
// Flow: cart → delivery method → (pickup point | address) → priced
// options (DeliveryQuote rows) → choose one → place order.
import { z } from "zod";
import { db, type DbClient } from "../db.ts";
import { addWorkingDays } from "../delivery/dates.ts";
import { calculateParcel } from "../delivery/packaging.ts";
import { customerShippingPrice } from "../delivery/pricing.ts";
import { getDeliveryAdapter } from "../delivery/registry.ts";
import { METHOD_LABELS, METHOD_ORDER } from "../delivery/status.ts";
import type { DeliveryMethod, Destination, RateRequest, StreetAddress } from "../delivery/types.ts";
import { findOrCreateCustomer, giveConsent, rememberDeliveryChoice } from "./customers.ts";
import { dispatchAddress, enabledProvidersFor, providerContext } from "./delivery-settings.ts";
import { ConflictError, DeliveryUnavailableError, NotFoundError, ValidationError, zodMessage } from "./errors.ts";
import { getLocation } from "./locations.ts";
import { enqueueOrderNotification } from "./notifications.ts";
import type { Prisma } from "@prisma/client";

const QUOTE_TTL_MS = 30 * 60 * 1000;

// ─── Cart ─────────────────────────────────────────────────────────────

export async function createCart(tenantId: string, channel: "WEB" | "WHATSAPP", customerId: string | null = null) {
  return db.cart.create({ data: { tenantId, channel, customerId } });
}

async function openCart(tenantId: string, cartId: string, client: DbClient = db) {
  const cart = await client.cart.findFirst({ where: { id: cartId, tenantId } });
  if (!cart) throw new NotFoundError("Cart");
  if (cart.status !== "OPEN") throw new ConflictError("This cart has already been checked out.");
  return cart;
}

const clearedDelivery = {
  deliveryMethod: null,
  deliveryProviderId: null,
  deliveryServiceCode: null,
  deliveryLocationId: null,
  deliveryAddressId: null,
  deliveryQuoteId: null,
  shippingCents: null,
};

/** Sets a line's quantity (0 removes it). Changing items re-prices delivery. */
export async function setCartItem(tenantId: string, cartId: string, productId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999) throw new ValidationError("Quantity must be between 0 and 999.");
  await openCart(tenantId, cartId);
  const product = await db.product.findFirst({ where: { id: productId, tenantId, active: true } });
  if (!product) throw new NotFoundError("Product");

  await db.$transaction(async (tx) => {
    if (quantity === 0) await tx.cartItem.deleteMany({ where: { cartId, productId } });
    else
      await tx.cartItem.upsert({
        where: { cartId_productId: { cartId, productId } },
        update: { quantity },
        create: { cartId, productId, quantity },
      });
    // Parcel size and subtotal (free-shipping threshold) changed: the
    // chosen delivery price no longer holds.
    await tx.cart.update({ where: { id: cartId }, data: clearedDelivery });
  });
  return getCart(tenantId, cartId);
}

export async function addToCart(tenantId: string, cartId: string, productId: string, quantity: number) {
  const existing = await db.cartItem.findUnique({ where: { cartId_productId: { cartId, productId } } });
  return setCartItem(tenantId, cartId, productId, (existing?.quantity ?? 0) + quantity);
}

export async function getCart(tenantId: string, cartId: string) {
  const cart = await db.cart.findFirst({
    where: { id: cartId, tenantId },
    include: { items: { include: { product: true }, orderBy: { product: { name: "asc" } } }, deliveryProvider: true, deliveryLocation: true },
  });
  if (!cart) throw new NotFoundError("Cart");
  const subtotalCents = cart.items.reduce((sum, i) => sum + i.product.priceCents * i.quantity, 0);
  const quote = cart.deliveryQuoteId ? await db.deliveryQuote.findUnique({ where: { id: cart.deliveryQuoteId } }) : null;
  return {
    ...cart,
    subtotalCents,
    selectedQuote: quote,
    totalCents: cart.shippingCents === null ? null : subtotalCents + cart.shippingCents,
  };
}
export type CartView = Awaited<ReturnType<typeof getCart>>;

// ─── Delivery methods ────────────────────────────────────────────────

export interface MethodOption {
  method: DeliveryMethod;
  label: string;
}

/** The (up to four) answers to "How would you like to receive your order?" */
export async function getDeliveryMethods(tenantId: string): Promise<MethodOption[]> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const providers = await enabledProvidersFor(tenantId);
  const available = new Set(providers.flatMap((p) => p.methods));
  return METHOD_ORDER.filter((m) => available.has(m)).map((method) => ({
    method,
    label:
      method === "SELLER_COLLECTION" && tenant?.sellerDisplayName ? `Collect from ${tenant.sellerDisplayName}` : METHOD_LABELS[method],
  }));
}

// ─── Quotes ──────────────────────────────────────────────────────────

const addressSchema = z.object({
  recipientName: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  street: z.string().trim().min(3, "Enter the street address.").max(200),
  complex: z.string().trim().max(120).nullable().optional(),
  suburb: z.string().trim().min(2, "Enter the suburb.").max(100),
  city: z.string().trim().min(2, "Enter the town or city.").max(100),
  province: z.string().trim().max(60).nullable().optional(),
  postcode: z.string().trim().regex(/^\d{4}$/, "Postcode must be 4 digits."),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

export const quoteRequestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("PAXI_PICKUP"), locationId: z.string().uuid() }),
  z.object({ method: z.literal("DOOR_COURIER"), address: addressSchema }),
  z.object({ method: z.literal("SAME_DAY"), address: addressSchema }),
  z.object({ method: z.literal("SELLER_COLLECTION") }),
]);
export type QuoteRequest = z.input<typeof quoteRequestSchema>;

export interface DeliveryOptionView {
  quoteId: string;
  method: DeliveryMethod;
  providerName: string;
  serviceName: string;
  priceCents: number;
  free: boolean;
  etaLabel: string | null;
  priceNote: string;
}

export interface QuoteResult {
  method: DeliveryMethod;
  options: DeliveryOptionView[];
  /** When nothing is available: the other methods the customer can pick. */
  alternatives: MethodOption[];
}

export async function quoteDelivery(tenantId: string, cartId: string, input: QuoteRequest, now = new Date()): Promise<QuoteResult> {
  const parsed = quoteRequestSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const request = parsed.data;

  await openCart(tenantId, cartId);
  const cart = await getCart(tenantId, cartId);
  if (cart.items.length === 0) throw new ValidationError("Your cart is empty.");

  const providers = await enabledProvidersFor(tenantId, request.method);
  if (providers.length === 0) throw new DeliveryUnavailableError(`${METHOD_LABELS[request.method]} isn't offered by this shop.`);

  const location = request.method === "PAXI_PICKUP" ? await getLocation(request.locationId) : null;
  const options: DeliveryOptionView[] = [];

  for (const row of providers) {
    if (location && location.providerId !== row.providerId) continue;
    const adapter = getDeliveryAdapter(row.provider.code, row.provider.name);
    const origin = dispatchAddress(row);

    let destination: Destination;
    if (request.method === "PAXI_PICKUP") destination = { kind: "PICKUP_POINT", location: location! };
    else if (request.method === "SELLER_COLLECTION") {
      const cfg = (row.config ?? {}) as { instructions?: string };
      destination = { kind: "SELLER_COLLECTION", address: origin, instructions: cfg.instructions ?? null };
    } else destination = { kind: "ADDRESS", address: request.address as StreetAddress };

    const parcel = calculateParcel(
      cart.items.map((i) => ({ quantity: i.quantity, ...pick(i.product, ["weightGrams", "lengthCm", "widthCm", "heightCm"]) })),
      row,
    );
    const rateRequest: RateRequest = {
      method: request.method,
      origin,
      destination,
      parcel,
      declaredValueCents: cart.subtotalCents,
      // Handling time applies to scheduled delivery; same-day means
      // dispatching today, and the provider decides if that's possible.
      readyAt: request.method === "SAME_DAY" ? now : addWorkingDays(now, row.handlingTimeDays),
      now,
    };

    let rates;
    try {
      rates = await adapter.getRates(providerContext(row), rateRequest);
    } catch (error) {
      // One courier being down must not break checkout: its options are
      // simply not shown (and never replaced with a guessed price).
      console.error(`Rates failed for ${row.provider.code}:`, error);
      continue;
    }

    for (const rate of rates) {
      if (rate.method !== request.method) continue;
      const price = customerShippingPrice(rate.rateCents, cart.subtotalCents, row);
      const quote = await db.deliveryQuote.create({
        data: {
          tenantId,
          cartId,
          providerId: row.providerId,
          method: request.method,
          serviceCode: rate.serviceCode,
          serviceName: rate.serviceName,
          providerRateCents: rate.rateCents,
          priceCents: price.priceCents,
          etaMinDays: rate.etaMinDays,
          etaMaxDays: rate.etaMaxDays,
          etaLabel: rate.etaLabel,
          deliveryLocationId: location?.id ?? null,
          destination: { ...destination, parcel } as unknown as Prisma.InputJsonValue,
          providerData: (rate.providerData ?? {}) as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + QUOTE_TTL_MS),
        },
      });
      options.push({
        quoteId: quote.id,
        method: request.method,
        providerName: row.provider.name,
        serviceName: rate.serviceName,
        priceCents: price.priceCents,
        free: price.free,
        etaLabel: rate.etaLabel,
        priceNote: price.breakdown,
      });
    }
  }

  options.sort((a, b) => a.priceCents - b.priceCents);
  const alternatives =
    options.length === 0 ? (await getDeliveryMethods(tenantId)).filter((m) => m.method !== request.method && m.method !== "SELLER_COLLECTION") : [];
  return { method: request.method, options: dedupeByService(options), alternatives };
}

// Several providers can offer the same kind of service; the customer only
// needs the cheapest of each named service ("Economy", "Fast", ...).
function dedupeByService(options: DeliveryOptionView[]): DeliveryOptionView[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    const key = `${o.method}:${o.serviceName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K>;
}

export async function selectDeliveryQuote(tenantId: string, cartId: string, quoteId: string, now = new Date()) {
  await openCart(tenantId, cartId);
  const quote = await db.deliveryQuote.findFirst({ where: { id: quoteId, cartId, tenantId } });
  if (!quote) throw new NotFoundError("Delivery option");
  if (quote.expiresAt < now) throw new ConflictError("That delivery price has expired. Please choose your delivery option again.");

  await db.cart.update({
    where: { id: cartId },
    data: {
      deliveryMethod: quote.method,
      deliveryProviderId: quote.providerId,
      deliveryServiceCode: quote.serviceCode,
      deliveryLocationId: quote.deliveryLocationId,
      deliveryAddressId: null,
      deliveryQuoteId: quote.id,
      shippingCents: quote.priceCents,
    },
  });
  return getCart(tenantId, cartId);
}

// ─── Place order ─────────────────────────────────────────────────────

export const placeOrderSchema = z.object({
  customerName: z.string().trim().min(1, "Enter your name.").max(100),
  customerPhone: z.string().trim().min(9).max(20),
  customerEmail: z.string().trim().email().nullable().optional(),
  rememberPreferences: z.boolean().optional(),
});

export async function placeOrder(tenantId: string, cartId: string, input: z.input<typeof placeOrderSchema>, now = new Date()) {
  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));

  const cart = await getCart(tenantId, cartId);
  if (cart.status !== "OPEN") throw new ConflictError("This cart has already been checked out.");
  if (cart.items.length === 0) throw new ValidationError("Your cart is empty.");
  const quote = cart.selectedQuote;
  if (!quote || cart.shippingCents === null || !cart.deliveryMethod || !cart.deliveryProviderId || !cart.deliveryServiceCode) {
    throw new ValidationError("Choose how you'd like to receive your order.");
  }
  if (quote.expiresAt < now) throw new ConflictError("That delivery price has expired. Please choose your delivery option again.");

  const tdp = await db.tenantDeliveryProvider.findFirst({
    where: { tenantId, providerId: quote.providerId, enabled: true },
    include: { provider: true },
  });
  if (!tdp) throw new DeliveryUnavailableError("That delivery option is no longer available. Please choose another.");

  const destination = quote.destination as unknown as Destination & { parcel: { lengthCm: number; widthCm: number; heightCm: number; weightGrams: number } };

  const order = await db.$transaction(async (tx) => {
    const customer = await findOrCreateCustomer(tenantId, parsed.data.customerPhone, parsed.data.customerName, tx);
    if (parsed.data.customerEmail && !customer.email) await tx.customer.update({ where: { id: customer.id }, data: { email: parsed.data.customerEmail } });
    if (parsed.data.rememberPreferences) await giveConsent(customer.id, tx);

    // Atomic per-tenant order number.
    const tenant = await tx.tenant.update({ where: { id: tenantId }, data: { nextOrderNo: { increment: 1 } } });
    const number = `${tenant.orderPrefix}-${tenant.nextOrderNo - 1}`;

    const created = await tx.order.create({
      data: {
        tenantId,
        number,
        customerId: customer.id,
        cartId: cart.id,
        channel: cart.channel,
        subtotalCents: cart.subtotalCents,
        shippingCents: cart.shippingCents!,
        totalCents: cart.subtotalCents + cart.shippingCents!,
        deliveryMethod: cart.deliveryMethod!,
        deliveryProviderId: cart.deliveryProviderId!,
        deliveryServiceCode: cart.deliveryServiceCode!,
        deliveryLocationId: cart.deliveryLocationId,
        deliveryDestination: quote.destination as Prisma.InputJsonValue,
        items: {
          create: cart.items.map((i) => ({
            productId: i.productId,
            name: i.product.name,
            unitPriceCents: i.product.priceCents,
            quantity: i.quantity,
          })),
        },
      },
    });

    await tx.shipment.create({
      data: {
        tenantId,
        orderId: created.id,
        providerId: quote.providerId,
        mode: tdp.mode,
        status: "PENDING",
        serviceCode: quote.serviceCode,
        parcelLengthCm: destination.parcel.lengthCm,
        parcelWidthCm: destination.parcel.widthCm,
        parcelHeightCm: destination.parcel.heightCm,
        parcelWeightGrams: destination.parcel.weightGrams,
        destination: quote.destination as Prisma.InputJsonValue,
        providerData: { quote: quote.providerData } as Prisma.InputJsonValue,
      },
    });

    await tx.cart.update({ where: { id: cart.id }, data: { status: "CHECKED_OUT", customerId: customer.id } });
    await rememberDeliveryChoice(tx, customer.id, tenantId, {
      method: cart.deliveryMethod!,
      pickupLocationId: cart.deliveryLocationId,
      address: destination.kind === "ADDRESS" ? destination.address : null,
    });
    return created;
  });

  return { order, paymentUrl: paymentUrl(order.id) };
}

export function paymentUrl(orderId: string): string {
  return `${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/pay/${orderId}`;
}

// ─── Payment (gateway integration point) ──────────────────────────────

/**
 * Records payment. Called by the payment gateway's webhook handler once a
 * gateway is connected, or by the seller for EFT/cash ("Mark as paid").
 * Moves the shipment into the seller's fulfilment queue and notifies the
 * customer.
 */
export async function markOrderPaid(tenantId: string, orderId: string, paymentRef: string | null, now = new Date()) {
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, tenantId }, include: { shipments: true } });
    if (!order) throw new NotFoundError("Order");
    if (order.status !== "PENDING_PAYMENT") return { order, changed: false };

    const updated = await tx.order.update({ where: { id: orderId }, data: { status: "PAID", paidAt: now, paymentRef } });
    for (const shipment of order.shipments) {
      if (shipment.status !== "PENDING") continue;
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { status: shipment.mode === "ASSISTED" && (await isPaxi(tx, shipment.providerId)) ? "READY_FOR_REGISTRATION" : "READY_TO_BOOK" },
      });
    }
    return { order: updated, changed: true };
  });
  if (result.changed) await enqueueOrderNotification(tenantId, orderId, "ORDER_PAID");
  return result.order;
}

async function isPaxi(client: DbClient, providerId: string) {
  const provider = await client.deliveryProvider.findUnique({ where: { id: providerId } });
  return provider?.code === "PAXI";
}

/** Public payment page data. The order id (random UUID) is the capability. */
export async function getOrderForPayment(orderId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new NotFoundError("Order");
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { tenant: true, items: true },
  });
  if (!order) throw new NotFoundError("Order");
  return {
    id: order.id,
    number: order.number,
    shopName: order.tenant.name,
    status: order.status,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    destination: order.deliveryDestination as unknown as Destination,
    items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, lineCents: i.unitPriceCents * i.quantity })),
  };
}
