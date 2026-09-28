// Shop-level settings: display name, order-number prefix, and the linked
// WhatsApp Business number.
//
// Linking a WhatsApp number is restricted to platform admins: inbound
// messages are routed to whichever shop holds a phone_number_id, so a
// seller who could type any id could receive another shop's customers.
import { z } from "zod";
import { db } from "../db.ts";
import { isPlatformAdmin, type AuthenticatedUser } from "./auth.ts";
import { normalisePhone } from "./customers.ts";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, zodMessage } from "./errors.ts";

export async function getShopSettings(user: AuthenticatedUser) {
  const tenant = await db.tenant.findUnique({ where: { id: user.tenantId } });
  if (!tenant) throw new NotFoundError("Shop");
  return {
    name: tenant.name,
    slug: tenant.slug,
    sellerDisplayName: tenant.sellerDisplayName,
    orderPrefix: tenant.orderPrefix,
    whatsappPhoneId: tenant.whatsappPhoneId,
    whatsappNumber: tenant.whatsappNumber,
    yocoConnected: !!tenant.yocoSecretKeyEncrypted,
    yocoTestMode: tenant.yocoTestMode,
    paymentInstructions: tenant.paymentInstructions,
    canLinkWhatsApp: isPlatformAdmin(user),
    whatsappConfigured: !!process.env.WHATSAPP_META_ACCESS_TOKEN && !!process.env.WHATSAPP_META_APP_SECRET,
  };
}

export const shopSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    sellerDisplayName: z.string().trim().min(1).max(40).nullable(),
    orderPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,6}$/, "Order prefix must be 2–6 letters, e.g. SHS or CC."),
    // The seller's own number, for "Chat with …" links and order alerts.
    whatsappNumber: z.string().trim().max(20).nullable(),
    whatsappPhoneId: z
      .string()
      .trim()
      .regex(/^\d{6,20}$/, "The WhatsApp phone number ID is the long number from Meta (WhatsApp → API Setup), not the phone number itself.")
      .nullable(),
  })
  .partial();

export interface PhoneLookup {
  (phoneNumberId: string): Promise<{ displayPhoneNumber: string; verifiedName: string | null } | null>;
}

/** Confirms with Meta that the platform's token can send from this number. */
export const lookupWhatsAppNumber: PhoneLookup = async (phoneNumberId) => {
  const token = process.env.WHATSAPP_META_ACCESS_TOKEN;
  if (!token) return null;
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new ValidationError("Meta doesn't recognise that phone number ID for this platform's WhatsApp account. Check WhatsApp → API Setup.");
  }
  const body = (await response.json()) as { display_phone_number?: string; verified_name?: string };
  return { displayPhoneNumber: body.display_phone_number ?? phoneNumberId, verifiedName: body.verified_name ?? null };
};

export async function updateShopSettings(
  user: AuthenticatedUser,
  input: z.input<typeof shopSettingsSchema>,
  lookup: PhoneLookup = lookupWhatsAppNumber,
) {
  const parsed = shopSettingsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const { whatsappPhoneId, whatsappNumber, ...rest } = parsed.data;

  let linkedNumber: string | null = null;
  if (whatsappPhoneId !== undefined) {
    if (!isPlatformAdmin(user)) throw new ForbiddenError("Only platform administrators can link a WhatsApp number.");
    if (whatsappPhoneId) linkedNumber = (await lookup(whatsappPhoneId))?.displayPhoneNumber ?? null;
  }

  try {
    await db.tenant.update({
      where: { id: user.tenantId },
      data: {
        ...rest,
        ...(whatsappPhoneId !== undefined ? { whatsappPhoneId } : {}),
        ...(whatsappNumber !== undefined ? { whatsappNumber: whatsappNumber ? normalisePhone(whatsappNumber) : null } : {}),
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new ConflictError("That WhatsApp number is already linked to another shop.");
    throw error;
  }
  return { ...(await getShopSettings(user)), linkedNumber };
}
