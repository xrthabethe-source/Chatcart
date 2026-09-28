// "Connect my WhatsApp": a seller links their own WhatsApp Business
// number to their shop through Meta's Embedded Signup, without any
// developer setup of their own. Meta proves they own the number, so —
// unlike typing a phone number ID by hand — no admin is needed.
//
// Platform prerequisites (once, by the platform owner; see
// docs/deploy.md): a Meta app with Tech Provider access and an Embedded
// Signup configuration (META_EMBEDDED_SIGNUP_CONFIG_ID).
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "../db.ts";
import { decryptCredentials, encryptCredentials } from "../delivery/credentials.ts";
import { WHATSAPP_TEMPLATES } from "../delivery/messages.ts";
import {
  createTemplate,
  exchangeCode,
  GraphError,
  listPhoneNumbers,
  listTemplates,
  registerNumber,
  subscribeApp,
  unsubscribeApp,
  type FetchLike,
} from "../whatsapp/meta-graph.ts";
import type { AuthenticatedUser } from "./auth.ts";
import { ConflictError, DeliveryUnavailableError, ValidationError, zodMessage } from "./errors.ts";

let fetchImpl: FetchLike = (input, init) => fetch(input, init);
export function setGraphFetchForTests(fn: FetchLike | null) {
  fetchImpl = fn ?? ((input, init) => fetch(input, init));
}

const seal = (value: string) => encryptCredentials({ value });
const unseal = (blob: string | null) => decryptCredentials(blob)?.value ?? null;

/** Templates sent to customers from the seller's own number. */
const CUSTOMER_TEMPLATES = Object.values(WHATSAPP_TEMPLATES).filter((t) => t.name !== "seller_new_order");

export function whatsappConnectConfig() {
  const appId = process.env.META_APP_ID ?? "";
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? "";
  return { enabled: !!(appId && configId && process.env.WHATSAPP_META_APP_SECRET), appId, configId };
}

export async function getWhatsAppConnection(user: AuthenticatedUser, withTemplates = false) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const connected = !!(tenant.whatsappPhoneId && tenant.whatsappAccessTokenEncrypted && tenant.whatsappBusinessAccountId);
  let templates: { approved: number; pending: number; rejected: number; total: number } | null = null;
  if (connected && withTemplates) {
    try {
      const list = await listTemplates(fetchImpl, unseal(tenant.whatsappAccessTokenEncrypted)!, tenant.whatsappBusinessAccountId!);
      const ours = list.filter((t) => CUSTOMER_TEMPLATES.some((c) => c.name === t.name));
      templates = {
        approved: ours.filter((t) => t.status === "APPROVED").length,
        pending: ours.filter((t) => t.status === "PENDING" || t.status === "IN_APPEAL").length,
        rejected: ours.filter((t) => t.status === "REJECTED").length,
        total: CUSTOMER_TEMPLATES.length,
      };
    } catch {
      templates = null; // status is best-effort; never block the page
    }
  }
  return {
    available: whatsappConnectConfig().enabled,
    connected,
    displayNumber: tenant.whatsappDisplayNumber,
    coexistence: tenant.whatsappCoexistence,
    connectedAt: tenant.whatsappConnectedAt,
    templates,
  };
}

export const embeddedSignupSchema = z.object({
  code: z.string().trim().min(10).max(2000),
  wabaId: z.string().trim().regex(/^\d{5,25}$/),
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/),
  // true when the seller kept their number on the WhatsApp Business app.
  coexistence: z.boolean().default(false),
});

export async function completeEmbeddedSignup(user: AuthenticatedUser, input: z.input<typeof embeddedSignupSchema>) {
  const parsed = embeddedSignupSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const { code, wabaId, phoneNumberId, coexistence } = parsed.data;
  const config = whatsappConnectConfig();
  if (!config.enabled) throw new DeliveryUnavailableError("Connecting WhatsApp isn't switched on for Chatcart yet.");

  const owner = await db.tenant.findUnique({ where: { whatsappPhoneId: phoneNumberId } });
  if (owner && owner.id !== user.tenantId) throw new ConflictError("That WhatsApp number is already connected to another shop.");

  try {
    const token = await exchangeCode(fetchImpl, config.appId, process.env.WHATSAPP_META_APP_SECRET!, code);
    // The browser told us which number was chosen; only trust it if the
    // token Meta just issued can actually see that number.
    const numbers = await listPhoneNumbers(fetchImpl, token, wabaId);
    const number = numbers.find((n) => n.id === phoneNumberId);
    if (!number) throw new ValidationError("Meta didn't confirm that WhatsApp number for your account. Please try connecting again.");

    await subscribeApp(fetchImpl, token, wabaId);
    if (!coexistence) {
      // A fresh Cloud API number needs registering, with a two-step PIN.
      await registerNumber(fetchImpl, token, phoneNumberId, String(randomInt(100000, 1000000)));
    }

    await db.tenant.update({
      where: { id: user.tenantId },
      data: {
        whatsappPhoneId: phoneNumberId,
        whatsappBusinessAccountId: wabaId,
        whatsappAccessTokenEncrypted: seal(token),
        whatsappDisplayNumber: number.displayPhoneNumber,
        whatsappCoexistence: coexistence,
        whatsappConnectedAt: new Date(),
      },
    });

    // Submit our delivery-update templates to their account. Failures
    // here don't undo the connection: status shows on Shop settings and
    // a reconnect resubmits.
    const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en";
    const failed: string[] = [];
    for (const spec of CUSTOMER_TEMPLATES) {
      await createTemplate(fetchImpl, token, wabaId, spec, language).catch(() => failed.push(spec.name));
    }
    return { ...(await getWhatsAppConnection(user)), templatesFailed: failed };
  } catch (error) {
    if (error instanceof GraphError) throw new ValidationError(`WhatsApp couldn't be connected: ${error.message}`);
    throw error;
  }
}

/** Back to share-link mode (updates from the shared Chatcart number). */
export async function disconnectWhatsApp(user: AuthenticatedUser) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const token = unseal(tenant.whatsappAccessTokenEncrypted);
  if (token && tenant.whatsappBusinessAccountId) {
    await unsubscribeApp(fetchImpl, token, tenant.whatsappBusinessAccountId).catch(() => undefined);
  }
  await db.tenant.update({
    where: { id: tenant.id },
    data: {
      whatsappPhoneId: null,
      whatsappBusinessAccountId: null,
      whatsappAccessTokenEncrypted: null,
      whatsappDisplayNumber: null,
      whatsappCoexistence: false,
      whatsappConnectedAt: null,
    },
  });
  return getWhatsAppConnection(user);
}

/** The token to send with from this shop's own number, if connected. */
export function shopWhatsAppToken(tenant: { whatsappAccessTokenEncrypted: string | null }): string | null {
  return unseal(tenant.whatsappAccessTokenEncrypted);
}
