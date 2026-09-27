// WhatsApp ordering conversation.
//
//   Customer: "I want 2 Product A"
//   → Added ✓  How would you like to receive your order?
//   → (PAXI)   "Please send your suburb/town or share your location"
//   → nearby PAXI Points → choose → totals → PAY SECURELY
//
// It drives the very same checkout services as the web storefront, so
// delivery options, prices and remembered preferences are identical on
// both channels. State lives in `conversations` (one row per customer
// per shop). Every reply carries numbered options, so it works with
// plain text as well as with interactive buttons/lists (option ids).
import { db } from "../db.ts";
import { formatDistance } from "../delivery/geo.ts";
import { renderTrackingSummary } from "../delivery/messages.ts";
import { rands } from "../delivery/pricing.ts";
import type { DeliveryMethod, Destination, StreetAddress } from "../delivery/types.ts";
import {
  addToCart,
  createCart,
  getCart,
  getDeliveryMethods,
  placeOrder,
  quoteDelivery,
  selectDeliveryQuote,
  type DeliveryOptionView,
  type MethodOption,
} from "./checkout.ts";
import { findOrCreateCustomer, forgetPreferences, getReturningSuggestion, normalisePhone } from "./customers.ts";
import { ServiceError } from "./errors.ts";
import { searchPickupPoints } from "./locations.ts";
import { findProductByText, listActiveProducts } from "./products.ts";
import { shipmentSummary } from "./notifications.ts";
import type { Prisma } from "@prisma/client";

export interface InboundMessage {
  phone: string;
  profileName?: string | null;
  text?: string | null;
  /** id of a tapped interactive button/list row */
  optionId?: string | null;
  location?: { latitude: number; longitude: number } | null;
}

export interface ReplyOption {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppReply {
  text: string;
  options?: ReplyOption[];
  /** Ask the client to show a "Send location" affordance. */
  requestLocation?: boolean;
}

type State =
  | "IDLE"
  | "RETURNING_CONFIRM"
  | "CHOOSE_METHOD"
  | "PAXI_SEARCH"
  | "PAXI_CHOOSE"
  | "ADDRESS_INPUT"
  | "CHOOSE_OPTION"
  | "CONFIRM";

interface Context {
  method?: DeliveryMethod;
  options?: ReplyOption[]; // what the numbers in the last reply meant
  address?: StreetAddress;
  suggestion?: { method: DeliveryMethod; locationId?: string; address?: StreetAddress };
}

const METHOD_EMOJI: Record<DeliveryMethod, string> = {
  PAXI_PICKUP: "🏪",
  DOOR_COURIER: "🚚",
  SAME_DAY: "⚡",
  SELLER_COLLECTION: "📦",
};

const SHORT_METHOD_LABEL: Record<DeliveryMethod, string> = {
  PAXI_PICKUP: "Collect at PEP",
  DOOR_COURIER: "Deliver to my door",
  SAME_DAY: "Same-day",
  SELLER_COLLECTION: "Collect from seller",
};

export async function handleWhatsAppMessage(tenantId: string, message: InboundMessage, now = new Date()): Promise<WhatsAppReply> {
  const phone = normalisePhone(message.phone);
  const convo = await db.conversation.upsert({
    where: { tenantId_phone: { tenantId, phone } },
    update: { lastInboundAt: now },
    create: { tenantId, phone, lastInboundAt: now },
  });
  const flow = new Flow(tenantId, phone, message, convo.state as State, (convo.context ?? {}) as Context, convo.cartId, now);
  let reply: WhatsAppReply;
  try {
    reply = await flow.run();
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    reply = { text: `Sorry — ${error.message}` };
  }
  await db.conversation.update({
    where: { id: convo.id },
    data: { state: flow.state, context: flow.context as Prisma.InputJsonValue, cartId: flow.cartId },
  });
  return reply;
}

class Flow {
  readonly tenantId: string;
  readonly phone: string;
  readonly msg: InboundMessage;
  readonly now: Date;
  state: State;
  context: Context;
  cartId: string | null;

  constructor(tenantId: string, phone: string, msg: InboundMessage, state: State, context: Context, cartId: string | null, now: Date) {
    this.tenantId = tenantId;
    this.phone = phone;
    this.msg = msg;
    this.state = state;
    this.context = context;
    this.cartId = cartId;
    this.now = now;
  }

  private get text(): string {
    return (this.msg.text ?? "").trim();
  }

  /** Resolves a numbered reply or a tapped option to the option id. */
  private chosen(): string | null {
    if (this.msg.optionId) return this.msg.optionId;
    const options = this.context.options ?? [];
    const n = /^\s*(?:select\s*)?(\d{1,2})\s*$/i.exec(this.text);
    if (n) return options[Number(n[1]) - 1]?.id ?? null;
    const t = this.text.toLowerCase();
    return options.find((o) => o.title.toLowerCase() === t)?.id ?? null;
  }

  async run(): Promise<WhatsAppReply> {
    const t = this.text.toLowerCase();

    if (/^(track|track my order|where is my order\??)$/.test(t) || this.msg.optionId === "track") return this.track();
    if (t === "forget" || t === "forget me") {
      const customer = await db.customer.findUnique({ where: { tenantId_phone: { tenantId: this.tenantId, phone: this.phone } } });
      if (customer) await forgetPreferences(this.tenantId, customer.id);
      return { text: "Done — we've forgotten your saved delivery details. We'll ask each time from now on." };
    }
    if (t === "cancel" || t === "restart") {
      this.reset();
      return { text: "No problem, I've cleared that. Send what you'd like to order any time, or TRACK to track an order." };
    }

    // Adding products works from any state.
    const added = await this.tryAddProduct();
    if (added) return added;

    switch (this.state) {
      case "RETURNING_CONFIRM":
        return this.onReturningConfirm();
      case "CHOOSE_METHOD":
        return this.onChooseMethod();
      case "PAXI_SEARCH":
        return this.onPaxiSearch();
      case "PAXI_CHOOSE":
        return this.onPaxiChoose();
      case "ADDRESS_INPUT":
        return this.onAddressInput();
      case "CHOOSE_OPTION":
        return this.onChooseOption();
      case "CONFIRM":
        return this.onConfirm();
      default:
        return this.greeting();
    }
  }

  private reset() {
    this.state = "IDLE";
    this.context = {};
    this.cartId = null;
  }

  private async greeting(): Promise<WhatsAppReply> {
    const products = await listActiveProducts(this.tenantId);
    const tenant = await db.tenant.findUnique({ where: { id: this.tenantId } });
    if (products.length === 0) {
      return {
        text: `Hi! 👋 Welcome to ${tenant?.name ?? "our shop"}. We're still adding our products — please check back soon.\nSend TRACK to track an order.`,
        options: [{ id: "track", title: "Track My Order" }],
      };
    }
    const list = products.slice(0, 10).map((p) => `• ${p.name} — ${rands(p.priceCents)}`).join("\n");
    return {
      text: `Hi! 👋 Welcome to ${tenant?.name ?? "our shop"}.\n\n${list}\n\nTell me what you'd like, e.g. "I want 2 ${products[0]?.name ?? "Product A"}".\nSend TRACK to track an order.`,
      options: [{ id: "track", title: "Track My Order" }],
    };
  }

  // ── Products ───────────────────────────────────────────────────────

  private async tryAddProduct(): Promise<WhatsAppReply | null> {
    if (this.msg.optionId || !this.text || this.msg.location) return null;
    // Free text in these steps is a suburb or an address, not a product.
    if (this.state === "PAXI_SEARCH" || this.state === "PAXI_CHOOSE" || this.state === "ADDRESS_INPUT") return null;
    const intent = /^(i\s*(would|'d)?\s*(want|like|need)|can i (get|have)|please|add|order|i'll take)\s+/i;
    const hasIntent = intent.test(this.text);
    const cleaned = this.text.replace(intent, "").replace(/\s+please$/i, "").trim();

    let quantity: number;
    let name: string;
    const lead = /^(\d{1,3})\s*(?:x\s*)?(\D.*)$/i.exec(cleaned);
    const trail = /^(.+?)\s*x\s*(\d{1,3})$/i.exec(cleaned);
    if (lead) [quantity, name] = [Number(lead[1]), lead[2]!];
    else if (trail) [quantity, name] = [Number(trail[2]), trail[1]!];
    else if (hasIntent) [quantity, name] = [1, cleaned];
    else return null;
    if (quantity < 1) return null;

    const product = await findProductByText(this.tenantId, name);
    if (!product) return null;

    if (!this.cartId || (await db.cart.findUnique({ where: { id: this.cartId } }))?.status !== "OPEN") {
      const customer = await findOrCreateCustomer(this.tenantId, this.phone, this.msg.profileName ?? null);
      this.cartId = (await createCart(this.tenantId, "WHATSAPP", customer.id)).id;
    }
    await addToCart(this.tenantId, this.cartId, product.id, quantity);
    const intro = `Added ✓ ${quantity} × ${product.name}`;
    return this.askMethod(intro);
  }

  // ── Delivery method ────────────────────────────────────────────────

  private async askMethod(intro: string): Promise<WhatsAppReply> {
    const customer = await db.customer.findUnique({ where: { tenantId_phone: { tenantId: this.tenantId, phone: this.phone } } });
    const methods = await getDeliveryMethods(this.tenantId);
    if (methods.length === 0) {
      return { text: `${intro}\n\nThis shop hasn't set up delivery yet — please contact the seller.` };
    }

    const suggestion = customer ? await getReturningSuggestion(customer.id) : null;
    const available = new Set(methods.map((m) => m.method));
    if (suggestion?.method === "PAXI_PICKUP" && suggestion.pickupLocation && available.has("PAXI_PICKUP")) {
      this.context = { suggestion: { method: "PAXI_PICKUP", locationId: suggestion.pickupLocation.id } };
      return this.ask("RETURNING_CONFIRM", `${intro}\n\nLast time you collected at:\n${suggestion.pickupLocation.name}\n\nUse it again?`, [
        { id: "yes", title: "YES" },
        { id: "other", title: "CHOOSE ANOTHER" },
      ]);
    }
    if ((suggestion?.method === "DOOR_COURIER" || suggestion?.method === "SAME_DAY") && suggestion.address && available.has(suggestion.method)) {
      const address: StreetAddress = { ...suggestion.address };
      delete (address as { id?: string }).id;
      this.context = { suggestion: { method: suggestion.method, address } };
      return this.ask("RETURNING_CONFIRM", `${intro}\n\nLast time we delivered to:\n${oneLine(address)}\n\nDeliver there again?`, [
        { id: "yes", title: "YES" },
        { id: "other", title: "CHOOSE ANOTHER" },
      ]);
    }
    return this.methodQuestion(intro, methods);
  }

  private methodQuestion(intro: string, methods: MethodOption[]): WhatsAppReply {
    this.context = {};
    const options = methods.map((m) => ({
      id: `method:${m.method}`,
      title: `${METHOD_EMOJI[m.method]} ${m.method === "SELLER_COLLECTION" ? m.label : SHORT_METHOD_LABEL[m.method]}`,
    }));
    return this.ask("CHOOSE_METHOD", `${intro}\n\nHow would you like to receive your order?`, options);
  }

  private ask(state: State, text: string, options: ReplyOption[], extra: Partial<WhatsAppReply> = {}): WhatsAppReply {
    this.state = state;
    this.context.options = options;
    const numbered = options.map((o, i) => `${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ""}`).join("\n");
    return { text: numbered ? `${text}\n\n${numbered}` : text, options, ...extra };
  }

  private async onReturningConfirm(): Promise<WhatsAppReply> {
    const choice = this.chosen() ?? (/^(y|yes|yebo)$/i.test(this.text) ? "yes" : null);
    const suggestion = this.context.suggestion;
    if (choice === "yes" && suggestion) {
      if (suggestion.method === "PAXI_PICKUP" && suggestion.locationId) return this.quoteAndOffer({ method: "PAXI_PICKUP", locationId: suggestion.locationId });
      if (suggestion.address) {
        this.context.address = suggestion.address;
        return this.quoteAndOffer({ method: suggestion.method as "DOOR_COURIER" | "SAME_DAY", address: suggestion.address });
      }
    }
    return this.methodQuestion("No problem.", await getDeliveryMethods(this.tenantId));
  }

  private async onChooseMethod(): Promise<WhatsAppReply> {
    const choice = this.chosen();
    if (!choice?.startsWith("method:")) return this.methodQuestion("Please choose one of these:", await getDeliveryMethods(this.tenantId));
    const method = choice.slice("method:".length) as DeliveryMethod;
    const keptAddress = this.context.address;
    this.context = { method };

    if (method === "PAXI_PICKUP") {
      return this.ask("PAXI_SEARCH", "Where would you like to collect?\nPlease send your suburb, town, postcode or PEP store name — or share your location 📍.", [], {
        requestLocation: true,
      });
    }
    if (method === "SELLER_COLLECTION") return this.quoteAndOffer({ method });

    if (keptAddress) {
      // Came here from "same-day isn't available" — reuse the address.
      this.context.address = keptAddress;
      return this.quoteAndOffer({ method, address: keptAddress });
    }
    return this.askAddress();
  }

  // ── PAXI ───────────────────────────────────────────────────────────

  private async onPaxiSearch(): Promise<WhatsAppReply> {
    const loc = this.msg.location;
    if (!loc && this.text.length < 2) {
      return this.ask("PAXI_SEARCH", "Please send your suburb or town (e.g. Tembisa), or share your location 📍.", [], { requestLocation: true });
    }
    const points = await searchPickupPoints(
      this.tenantId,
      loc ? { latitude: loc.latitude, longitude: loc.longitude, limit: 5 } : { text: this.text, limit: 5 },
    );
    if (points.length === 0) {
      return this.ask("PAXI_SEARCH", `I couldn't find a PAXI Point for "${this.text || "your location"}". Try a nearby suburb, town or postcode.`, [], {
        requestLocation: true,
      });
    }
    const options = points.map((p) => ({
      id: `point:${p.id}`,
      title: p.name,
      description: p.distanceKm !== null ? formatDistance(p.distanceKm) : [p.suburb, p.city].filter(Boolean).join(", "),
    }));
    return this.ask("PAXI_CHOOSE", "Nearby PAXI Points:", options);
  }

  private async onPaxiChoose(): Promise<WhatsAppReply> {
    const choice = this.chosen();
    if (!choice?.startsWith("point:")) {
      // Treat anything else as a new search.
      this.state = "PAXI_SEARCH";
      return this.onPaxiSearch();
    }
    return this.quoteAndOffer({ method: "PAXI_PICKUP", locationId: choice.slice("point:".length) });
  }

  // ── Address ────────────────────────────────────────────────────────

  private async askAddress(): Promise<WhatsAppReply> {
    return this.ask(
      "ADDRESS_INPUT",
      "Please send your delivery address in one message:\nStreet, Suburb, Town, Postcode\n\ne.g. 12 Vilakazi St, Orlando West, Soweto, 1804",
      [],
    );
  }

  private async onAddressInput(): Promise<WhatsAppReply> {
    const address = parseAddress(this.text);
    if (!address) {
      return this.ask("ADDRESS_INPUT", "I couldn't read that address. Please send it as:\nStreet, Suburb, Town, Postcode", []);
    }
    const customer = await db.customer.findUnique({ where: { tenantId_phone: { tenantId: this.tenantId, phone: this.phone } } });
    address.recipientName = customer?.name ?? this.msg.profileName ?? null;
    address.phone = this.phone;
    this.context.address = address;
    return this.quoteAndOffer({ method: this.context.method as "DOOR_COURIER" | "SAME_DAY", address });
  }

  // ── Options and totals ─────────────────────────────────────────────

  private async quoteAndOffer(
    request: { method: "PAXI_PICKUP"; locationId: string } | { method: "DOOR_COURIER" | "SAME_DAY"; address: StreetAddress } | { method: "SELLER_COLLECTION" },
  ): Promise<WhatsAppReply> {
    if (!this.cartId) return this.greeting();
    this.context.method = request.method;
    const result = await quoteDelivery(this.tenantId, this.cartId, request as Parameters<typeof quoteDelivery>[2], this.now);

    if (result.options.length === 0) {
      if (request.method === "SAME_DAY") {
        return this.ask(
          "CHOOSE_METHOD",
          "Same-day isn't available for this address.\nYou can choose:",
          // The customer just gave an address, so door delivery first.
          [...result.alternatives].sort((a, b) => Number(b.method === "DOOR_COURIER") - Number(a.method === "DOOR_COURIER")).map((m) => ({
            id: `method:${m.method}`,
            title: m.method === "DOOR_COURIER" ? "🚚 Standard courier" : m.method === "PAXI_PICKUP" ? "🏪 PEP/PAXI collection" : m.label,
          })),
        );
      }
      return this.methodQuestion("Sorry, that delivery option isn't available right now.", await getDeliveryMethods(this.tenantId));
    }

    if (request.method === "SAME_DAY") {
      const best = result.options[0]!;
      await selectDeliveryQuote(this.tenantId, this.cartId, best.quoteId, this.now);
      return this.totals(`Good news 🎉\nSame-day delivery is available.\nDelivery today ${best.free ? "FREE" : rands(best.priceCents)}`);
    }
    if (result.options.length === 1) {
      await selectDeliveryQuote(this.tenantId, this.cartId, result.options[0]!.quoteId, this.now);
      return this.totals();
    }
    return this.ask("CHOOSE_OPTION", "Choose your delivery:", result.options.map(optionReply));
  }

  private async onChooseOption(): Promise<WhatsAppReply> {
    const choice = this.chosen();
    if (!choice?.startsWith("quote:") || !this.cartId) {
      return this.ask("CHOOSE_OPTION", "Please reply with the number of the delivery option:", this.context.options ?? []);
    }
    await selectDeliveryQuote(this.tenantId, this.cartId, choice.slice("quote:".length), this.now);
    return this.totals();
  }

  private async totals(prefix?: string): Promise<WhatsAppReply> {
    const cart = await getCart(this.tenantId, this.cartId!);
    const quote = cart.selectedQuote!;
    const destination = quote.destination as unknown as Destination;
    const deliveryName =
      quote.method === "PAXI_PICKUP" ? "PAXI" : quote.method === "SELLER_COLLECTION" ? "Collection" : quote.method === "SAME_DAY" ? "Same-day" : "Delivery";
    const where =
      destination.kind === "PICKUP_POINT"
        ? `Collect at: ${destination.location.name}`
        : destination.kind === "ADDRESS"
          ? `Deliver to: ${oneLine(destination.address)}`
          : "Collect from the seller";
    const lines = [
      ...(prefix ? [prefix, ""] : []),
      where,
      "",
      `Products ${rands(cart.subtotalCents)}`,
      `${deliveryName} ${cart.shippingCents === 0 ? "FREE" : rands(cart.shippingCents!)}`,
      `TOTAL ${rands(cart.totalCents!)}`,
    ];
    return this.ask("CONFIRM", lines.join("\n"), [
      { id: "pay", title: "PAY SECURELY" },
      { id: "change", title: "Change delivery" },
    ]);
  }

  private async onConfirm(): Promise<WhatsAppReply> {
    const choice = this.chosen() ?? (/^pay/i.test(this.text) ? "pay" : null);
    if (choice === "change") return this.methodQuestion("Sure.", await getDeliveryMethods(this.tenantId));
    if (choice !== "pay" || !this.cartId) return this.totals();

    const customer = await db.customer.findUnique({ where: { tenantId_phone: { tenantId: this.tenantId, phone: this.phone } } });
    const { order, paymentUrl } = await placeOrder(
      this.tenantId,
      this.cartId,
      {
        customerName: customer?.name ?? this.msg.profileName ?? "WhatsApp customer",
        customerPhone: this.phone,
        // WhatsApp: the number is verified by the channel itself; the
        // reply below tells the customer and how to opt out (FORGET).
        rememberPreferences: true,
      },
      this.now,
    );
    this.reset();
    return {
      text: `Order ${order.number} — total ${rands(order.totalCents)}.\n\nPay securely here:\n${paymentUrl}\n\nWe'll remember your delivery choice to make next time quicker (reply FORGET to stop). Send TRACK any time to see where your order is.`,
    };
  }

  // ── Tracking ───────────────────────────────────────────────────────

  private async track(): Promise<WhatsAppReply> {
    const customer = await db.customer.findUnique({ where: { tenantId_phone: { tenantId: this.tenantId, phone: this.phone } } });
    if (!customer) return { text: "I couldn't find any orders for this number." };
    const orders = await db.order.findMany({
      where: { tenantId: this.tenantId, customerId: customer.id, status: { not: "CANCELLED" } },
      include: { shipments: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    if (orders.length === 0) return { text: "I couldn't find any orders for this number." };
    // Open orders first; else the most recent one.
    const open = orders.filter((o) => o.status !== "COMPLETED");
    const shown = (open.length ? open : orders.slice(0, 1)).slice(0, 3);
    const parts: string[] = [];
    for (const order of shown) {
      const shipment = order.shipments[0];
      if (!shipment) continue;
      parts.push(renderTrackingSummary(await shipmentSummary(shipment.id, this.now)));
    }
    return { text: parts.join("\n\n") || "I couldn't find any orders for this number." };
  }
}

function optionReply(o: DeliveryOptionView): ReplyOption {
  return {
    id: `quote:${o.quoteId}`,
    title: `${o.serviceName.toUpperCase()} ${o.free ? "FREE" : rands(o.priceCents)}`,
    description: o.etaLabel ?? undefined,
  };
}

function oneLine(a: StreetAddress): string {
  return [a.complex, a.street, a.suburb, a.city, a.postcode].filter(Boolean).join(", ");
}

/** "12 Vilakazi St, Orlando West, Soweto, 1804" → address, or null. */
export function parseAddress(text: string): StreetAddress | null {
  const parts = text.split(/[,\n]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 4) return null;
  const postcode = parts[parts.length - 1]!;
  if (!/^\d{4}$/.test(postcode)) return null;
  const city = parts[parts.length - 2]!;
  const suburb = parts[parts.length - 3]!;
  const street = parts.slice(0, parts.length - 3).join(", ");
  if (street.length < 3) return null;
  return { street, suburb, city, postcode };
}
