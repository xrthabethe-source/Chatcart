// Online payments. Each seller connects their own Yoco account, so the
// customer's money goes straight to the seller — Chatcart never holds
// funds. Sellers without Yoco can take EFT/cash and mark orders paid.
import { z } from "zod";
import { db } from "../db.ts";
import { decryptCredentials, encryptCredentials } from "../delivery/credentials.ts";
import {
  createCheckout,
  deleteWebhook,
  isYocoSecretKey,
  registerWebhook,
  verifyWebhook,
  YocoError,
  type FetchLike,
} from "../payments/yoco.ts";
import type { AuthenticatedUser } from "./auth.ts";
import { markOrderPaid } from "./checkout.ts";
import { ConflictError, DeliveryUnavailableError, NotFoundError, UnauthenticatedError, ValidationError, zodMessage } from "./errors.ts";
import { appBaseUrl } from "./invites.ts";

let fetchImpl: FetchLike = (input, init) => fetch(input, init);
export function setPaymentsFetchForTests(fn: FetchLike | null) {
  fetchImpl = fn ?? ((input, init) => fetch(input, init));
}

// Encrypted blobs reuse the courier-credentials envelope.
const seal = (value: string) => encryptCredentials({ value });
const unseal = (blob: string | null) => decryptCredentials(blob)?.value ?? null;

export function yocoWebhookUrl(tenantId: string): string {
  return `${appBaseUrl()}/api/v1/payments/yoco/webhook/${tenantId}`;
}

export const connectYocoSchema = z.object({ secretKey: z.string().trim() });

/**
 * Stores the seller's Yoco secret key and registers Chatcart's webhook on
 * their Yoco account (which also proves the key works).
 */
export async function connectYoco(user: AuthenticatedUser, input: z.input<typeof connectYocoSchema>) {
  const parsed = connectYocoSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const secretKey = parsed.data.secretKey;
  if (!isYocoSecretKey(secretKey)) {
    throw new ValidationError("That doesn't look like a Yoco secret key. It starts with sk_live_ (or sk_test_ for testing).");
  }

  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  let webhook;
  try {
    webhook = await registerWebhook(fetchImpl, secretKey, `chatcart-${tenant.slug}`, yocoWebhookUrl(tenant.id));
  } catch (error) {
    if (error instanceof YocoError) throw new ValidationError(error.message);
    throw error;
  }

  // Replace a previously connected key's webhook, best-effort.
  const oldKey = unseal(tenant.yocoSecretKeyEncrypted);
  if (oldKey && tenant.yocoWebhookId) await deleteWebhook(fetchImpl, oldKey, tenant.yocoWebhookId).catch(() => undefined);

  await db.tenant.update({
    where: { id: tenant.id },
    data: {
      yocoSecretKeyEncrypted: seal(secretKey),
      yocoWebhookId: webhook.id,
      yocoWebhookSecretEncrypted: seal(webhook.secret),
      yocoTestMode: secretKey.startsWith("sk_test_"),
    },
  });
  return { connected: true, testMode: secretKey.startsWith("sk_test_") };
}

export async function disconnectYoco(user: AuthenticatedUser) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const key = unseal(tenant.yocoSecretKeyEncrypted);
  if (key && tenant.yocoWebhookId) await deleteWebhook(fetchImpl, key, tenant.yocoWebhookId).catch(() => undefined);
  await db.tenant.update({
    where: { id: tenant.id },
    data: { yocoSecretKeyEncrypted: null, yocoWebhookId: null, yocoWebhookSecretEncrypted: null, yocoTestMode: false },
  });
}

export const paymentInstructionsSchema = z.object({ paymentInstructions: z.string().trim().max(600).nullable() });

export async function setPaymentInstructions(user: AuthenticatedUser, input: z.input<typeof paymentInstructionsSchema>) {
  const parsed = paymentInstructionsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  await db.tenant.update({ where: { id: user.tenantId }, data: { paymentInstructions: parsed.data.paymentInstructions || null } });
}

export async function getPaymentSettings(user: AuthenticatedUser) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  return { yocoConnected: !!tenant.yocoSecretKeyEncrypted, yocoTestMode: tenant.yocoTestMode, paymentInstructions: tenant.paymentInstructions };
}

/** Customer taps "Pay by card": creates a Yoco checkout for the order. */
export async function startYocoCheckout(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { tenant: true } });
  if (!order) throw new NotFoundError("Order");
  if (order.status !== "PENDING_PAYMENT") throw new ConflictError("This order has already been paid.");
  const key = unseal(order.tenant.yocoSecretKeyEncrypted);
  if (!key) throw new DeliveryUnavailableError("Card payments aren't set up for this shop. Please pay by EFT or contact the seller.");

  const payUrl = `${appBaseUrl()}/pay/${order.id}`;
  let checkout;
  try {
    checkout = await createCheckout(fetchImpl, key, {
      amountCents: order.totalCents,
      successUrl: `${payUrl}?result=success`,
      cancelUrl: `${payUrl}?result=cancelled`,
      failureUrl: `${payUrl}?result=failed`,
      metadata: { orderId: order.id, orderNumber: order.number },
      // One checkout per order amount: a double tap reuses it.
      idempotencyKey: `${order.id}:${order.totalCents}`,
    });
  } catch (error) {
    if (error instanceof YocoError) throw new DeliveryUnavailableError("Card payment isn't available right now. Please try again in a minute.");
    throw error;
  }
  await db.paymentCheckout.upsert({
    where: { provider_externalId: { provider: "YOCO", externalId: checkout.id } },
    update: {},
    create: {
      tenantId: order.tenantId,
      orderId: order.id,
      provider: "YOCO",
      externalId: checkout.id,
      amountCents: order.totalCents,
      redirectUrl: checkout.redirectUrl,
    },
  });
  return { redirectUrl: checkout.redirectUrl };
}

interface YocoEvent {
  id?: string;
  type?: string;
  payload?: {
    id?: string;
    amount?: number;
    currency?: string;
    status?: string;
    metadata?: { checkoutId?: string; orderId?: string };
  };
}

/**
 * Yoco → Chatcart webhook for one shop. Only a correctly signed
 * payment.succeeded for the exact order amount marks the order paid.
 */
export async function handleYocoWebhook(
  tenantId: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  now = Date.now(),
) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const secret = tenant ? unseal(tenant.yocoWebhookSecretEncrypted) : null;
  if (!tenant || !secret || !verifyWebhook(secret, headers, rawBody, now)) throw new UnauthenticatedError("Invalid webhook signature.");

  const event = JSON.parse(rawBody) as YocoEvent;
  if (event.type !== "payment.succeeded") return { handled: false };
  const payment = event.payload ?? {};
  const checkoutId = payment.metadata?.checkoutId;
  const checkout = checkoutId
    ? await db.paymentCheckout.findUnique({ where: { provider_externalId: { provider: "YOCO", externalId: checkoutId } } })
    : null;
  if (!checkout || checkout.tenantId !== tenantId) return { handled: false };

  if (payment.amount !== checkout.amountCents || (payment.currency && payment.currency !== "ZAR")) {
    await db.paymentCheckout.update({ where: { id: checkout.id }, data: { status: "FAILED" } });
    console.error(`Yoco amount mismatch for checkout ${checkout.externalId}: got ${payment.amount}, expected ${checkout.amountCents}`);
    return { handled: false };
  }
  await db.paymentCheckout.update({ where: { id: checkout.id }, data: { status: "SUCCEEDED" } });
  await markOrderPaid(tenantId, checkout.orderId, `yoco:${payment.id ?? checkout.externalId}`);
  return { handled: true };
}
