// The associate onboarding checklist: products → delivery → payments →
// share. Each step can be done from the /join wizard or later from the
// dashboard.
import { z } from "zod";
import { db } from "../db.ts";
import type { AuthenticatedUser } from "./auth.ts";
import { getDeliveryMethods } from "./checkout.ts";
import { listDeliverySettings, updateDeliveryProvider } from "./delivery-settings.ts";
import { ValidationError, zodMessage } from "./errors.ts";
import { appBaseUrl } from "./invites.ts";
import { getDefaultPaxiTariff } from "./platform-settings.ts";

export const quickDeliverySchema = z.object({
  street: z.string().trim().min(3, "Enter your street address.").max(200),
  suburb: z.string().trim().min(2, "Enter your suburb.").max(100),
  city: z.string().trim().min(2, "Enter your town or city.").max(100),
  province: z.string().trim().max(60).nullable().optional(),
  postcode: z.string().trim().regex(/^\d{4}$/, "Postcode must be 4 digits."),
  paxi: z.boolean(),
  collection: z.boolean(),
});

/**
 * One-screen delivery setup: the associate's address (used as dispatch
 * address for every provider and as the collection address), PEP/PAXI
 * with the platform's default prices, and collection from them.
 */
export async function setupQuickDelivery(user: AuthenticatedUser, input: z.input<typeof quickDeliverySchema>) {
  const parsed = quickDeliverySchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const d = parsed.data;
  if (!d.paxi && !d.collection) throw new ValidationError("Choose at least one way for customers to get their order.");

  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const address = {
    dispatchStreet: d.street,
    dispatchSuburb: d.suburb,
    dispatchCity: d.city,
    dispatchProvince: d.province ?? null,
    dispatchPostcode: d.postcode,
    dispatchContactName: user.name,
    dispatchContactPhone: tenant.whatsappNumber,
  };

  const tariff = d.paxi ? await getDefaultPaxiTariff() : null;
  if (d.paxi && !tariff) {
    throw new ValidationError("PEP / PAXI prices haven't been set up on Chatcart yet. Choose collection for now — PAXI can be switched on later.");
  }

  for (const row of await listDeliverySettings(user)) {
    const code = row.provider.code;
    if (code === "PAXI") {
      await updateDeliveryProvider(user, row.id, {
        ...address,
        enabled: d.paxi,
        mode: "ASSISTED",
        ...(tariff ? { config: { ...(row.config as object), tariff } } : {}),
      });
    } else if (code === "SELLER_COLLECTION") {
      await updateDeliveryProvider(user, row.id, { ...address, enabled: d.collection });
    } else if (!row.dispatchStreet) {
      // Pre-fill the address for providers they may switch on later.
      await updateDeliveryProvider(user, row.id, address);
    }
  }
  return getOnboardingStatus(user);
}

export async function getOnboardingStatus(user: AuthenticatedUser) {
  const [tenant, productCount, deliveryCount, paxiTariff] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    db.product.count({ where: { tenantId: user.tenantId, active: true } }),
    db.tenantDeliveryProvider.count({ where: { tenantId: user.tenantId, enabled: true } }),
    getDefaultPaxiTariff(),
  ]);
  const shopUrl = `${appBaseUrl()}/shop/${tenant.slug}`;
  // Only promise what this shop actually offers.
  const methods = new Set((await getDeliveryMethods(user.tenantId)).map((m) => m.method));
  const offers = [
    methods.has("PAXI_PICKUP") ? "collect at your nearest PEP store" : null,
    methods.has("DOOR_COURIER") || methods.has("SAME_DAY") ? "get it delivered to your door" : null,
    methods.has("SELLER_COLLECTION") ? "collect from me" : null,
  ].filter(Boolean);
  const how = offers.length ? ` You can ${offers.join(", or ")}.` : "";
  const shareText = `🛍️ You can now order from me online.${how}${tenant.yocoSecretKeyEncrypted ? " Pay securely by card." : ""}\n${shopUrl}`;
  return {
    shopName: tenant.name,
    shopUrl,
    shareText,
    // Opens WhatsApp with the message ready to send to a contact or group.
    whatsappShareUrl: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
    steps: {
      products: productCount > 0,
      delivery: deliveryCount > 0,
      payments: !!tenant.yocoSecretKeyEncrypted || !!tenant.paymentInstructions,
    },
    yocoConnected: !!tenant.yocoSecretKeyEncrypted,
    // PEP/PAXI can only be switched on once the platform prices exist.
    paxiAvailable: !!paxiTariff,
    paxiFromCents: paxiTariff ? Math.min(...paxiTariff.map((t) => t.rateCents)) : null,
    whatsappNumber: tenant.whatsappNumber,
    whatsappConnected: !!tenant.whatsappPhoneId,
  };
}
