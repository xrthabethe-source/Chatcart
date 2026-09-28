// Yoco online payments client (Checkout API + webhooks).
//
//   POST https://payments.yoco.com/api/checkouts  → { id, redirectUrl }
//   POST https://payments.yoco.com/api/webhooks   → { id, secret }
//   DELETE https://payments.yoco.com/api/webhooks/{id}
//
// Webhooks are signed Standard-Webhooks style: headers webhook-id,
// webhook-timestamp and webhook-signature ("v1,<base64 HMAC-SHA256 of
// `${id}.${timestamp}.${body}`>"), keyed with the base64 part of the
// "whsec_…" secret returned when the webhook was registered.
//
// Written from Yoco's published API docs and tested against recorded
// responses; confirm with a test key (sk_test_…) before going live.
import { createHmac, timingSafeEqual } from "node:crypto";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE = "https://payments.yoco.com/api";

export class YocoError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "YocoError";
    this.status = status;
  }
}

export function isYocoSecretKey(value: string): boolean {
  return /^sk_(test|live)_[A-Za-z0-9]{16,}$/.test(value);
}

async function call<T>(fetchFn: FetchLike, secretKey: string, method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new YocoError(`Couldn't reach Yoco: ${(error as Error).message}`, 0);
  }
  const text = await response.text();
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? "Yoco didn't accept that secret key." : `Yoco returned HTTP ${response.status}.`;
    throw new YocoError(`${message} ${text.slice(0, 200)}`.trim(), response.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface CreateCheckoutInput {
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  failureUrl: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export async function createCheckout(fetchFn: FetchLike, secretKey: string, input: CreateCheckoutInput) {
  const res = await call<{ id?: string; redirectUrl?: string }>(
    fetchFn,
    secretKey,
    "POST",
    "/checkouts",
    {
      amount: input.amountCents,
      currency: "ZAR",
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      failureUrl: input.failureUrl,
      metadata: input.metadata,
    },
    input.idempotencyKey,
  );
  if (!res.id || !res.redirectUrl) throw new YocoError("Yoco didn't return a checkout link.", 502);
  return { id: res.id, redirectUrl: res.redirectUrl };
}

export async function registerWebhook(fetchFn: FetchLike, secretKey: string, name: string, url: string) {
  const res = await call<{ id?: string; secret?: string }>(fetchFn, secretKey, "POST", "/webhooks", { name, url });
  if (!res.id || !res.secret) throw new YocoError("Yoco didn't return a webhook secret.", 502);
  return { id: res.id, secret: res.secret };
}

export async function deleteWebhook(fetchFn: FetchLike, secretKey: string, id: string) {
  await call(fetchFn, secretKey, "DELETE", `/webhooks/${encodeURIComponent(id)}`);
}

const TOLERANCE_SECONDS = 5 * 60;

/** Verifies a Yoco webhook delivery. Returns false for anything off. */
export function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false; // replay guard
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  // The header may carry several space-separated "v1,<sig>" entries.
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Test helper / docs: what Yoco sends. */
export function signWebhook(secret: string, id: string, timestamp: string, rawBody: string): string {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret, "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64")}`;
}
