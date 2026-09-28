// Meta Graph API calls used by "Connect my WhatsApp" (Embedded Signup).
//
// Flow (Meta's documented Embedded Signup for Tech Providers):
//   1. The browser runs FB.login with our Embedded Signup configuration
//      and gets back a short-lived `code`, plus (via a window message)
//      the WhatsApp Business Account id and phone number id chosen.
//   2. The server exchanges the code for a business token
//      (GET /oauth/access_token), confirms that token can see that
//      phone number (GET /{waba}/phone_numbers), subscribes our app to
//      the account's webhooks (POST /{waba}/subscribed_apps), registers
//      the number for Cloud API unless it stays on the WhatsApp Business
//      app ("coexistence"), and submits our message templates.
//
// Written from Meta's docs and tested against recorded responses; check
// it end to end with a real test number before inviting associates.
import type { TemplateSpec } from "../delivery/messages.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

export class GraphError extends Error {
  readonly status: number;
  readonly metaCode: number | null;
  constructor(message: string, status: number, metaCode: number | null = null) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.metaCode = metaCode;
  }
}

async function graph<T>(fetchFn: FetchLike, path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    throw new GraphError(`Couldn't reach Meta: ${(error as Error).message}`, 0);
  }
  const text = await response.text();
  const json = text ? (JSON.parse(text) as { error?: { message?: string; code?: number } } & T) : ({} as T);
  if (!response.ok) {
    const err = (json as { error?: { message?: string; code?: number } }).error;
    throw new GraphError(err?.message ?? `Meta returned HTTP ${response.status}.`, response.status, err?.code ?? null);
  }
  return json as T;
}

/** Exchanges the Embedded Signup `code` for a business access token. */
export async function exchangeCode(fetchFn: FetchLike, appId: string, appSecret: string, code: string): Promise<string> {
  const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
  const res = await graph<{ access_token?: string }>(fetchFn, `/oauth/access_token?${params}`);
  if (!res.access_token) throw new GraphError("Meta didn't return an access token.", 502);
  return res.access_token;
}

export interface PhoneNumberInfo {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
}

export async function listPhoneNumbers(fetchFn: FetchLike, token: string, wabaId: string): Promise<PhoneNumberInfo[]> {
  const res = await graph<{ data?: { id: string; display_phone_number?: string; verified_name?: string }[] }>(
    fetchFn,
    `/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`,
    { token },
  );
  return (res.data ?? []).map((p) => ({ id: p.id, displayPhoneNumber: p.display_phone_number ?? p.id, verifiedName: p.verified_name ?? null }));
}

/** Makes Meta send this account's message webhooks to our app. */
export async function subscribeApp(fetchFn: FetchLike, token: string, wabaId: string): Promise<void> {
  await graph(fetchFn, `/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "POST", token });
}

export async function unsubscribeApp(fetchFn: FetchLike, token: string, wabaId: string): Promise<void> {
  await graph(fetchFn, `/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "DELETE", token });
}

/**
 * Registers a number for Cloud API messaging, setting its two-step
 * verification PIN. Not used for coexistence numbers, which stay
 * registered on the WhatsApp Business app.
 */
export async function registerNumber(fetchFn: FetchLike, token: string, phoneNumberId: string, pin: string): Promise<void> {
  await graph(fetchFn, `/${encodeURIComponent(phoneNumberId)}/register`, {
    method: "POST",
    token,
    body: { messaging_product: "whatsapp", pin },
  });
}

/** Submits one of our message templates to the account for approval. */
export async function createTemplate(fetchFn: FetchLike, token: string, wabaId: string, spec: TemplateSpec, language: string): Promise<void> {
  try {
    await graph(fetchFn, `/${encodeURIComponent(wabaId)}/message_templates`, {
      method: "POST",
      token,
      body: {
        name: spec.name,
        language,
        category: "UTILITY",
        components: [{ type: "BODY", text: spec.body, example: { body_text: [spec.example] } }],
      },
    });
  } catch (error) {
    // Already submitted on an earlier connect: fine.
    if (error instanceof GraphError && /already exists/i.test(error.message)) return;
    throw error;
  }
}

export interface TemplateStatus {
  name: string;
  status: string; // APPROVED, PENDING, REJECTED, …
}

export async function listTemplates(fetchFn: FetchLike, token: string, wabaId: string): Promise<TemplateStatus[]> {
  const res = await graph<{ data?: { name: string; status: string }[] }>(
    fetchFn,
    `/${encodeURIComponent(wabaId)}/message_templates?fields=name,status&limit=100`,
    { token },
  );
  return (res.data ?? []).map((t) => ({ name: t.name, status: t.status }));
}
