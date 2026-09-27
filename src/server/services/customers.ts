// Customers and their remembered delivery preferences.
//
// Preferences (last PAXI point, last street address, preferred method)
// are remembered only with the customer's consent (POPIA), and a
// customer can withdraw it at any time ("FORGET" on WhatsApp), which
// deletes the remembered rows. Placed orders keep their own frozen
// destination snapshot, so forgetting never alters an order.
import { randomBytes } from "node:crypto";
import { db, type DbClient } from "../db.ts";
import type { DeliveryMethod, StreetAddress, StoredLocation } from "../delivery/types.ts";
import { sha256 } from "./auth.ts";
import { ValidationError } from "./errors.ts";
import { toStoredLocation } from "./locations.ts";

/** Normalises a South African number to WhatsApp's wa_id form: 27XXXXXXXXX. */
export function normalisePhone(input: string): string {
  const digits = String(input ?? "").replace(/\D+/g, "");
  let phone = digits;
  if (/^0\d{9}$/.test(digits)) phone = `27${digits.slice(1)}`;
  else if (/^27\d{9}$/.test(digits)) phone = digits;
  else if (/^\d{10,15}$/.test(digits)) phone = digits;
  else throw new ValidationError("Enter a valid cellphone number, e.g. 082 123 4567.");
  return phone;
}

export async function findOrCreateCustomer(tenantId: string, phoneInput: string, name?: string | null, client: DbClient = db) {
  const phone = normalisePhone(phoneInput);
  return client.customer.upsert({
    where: { tenantId_phone: { tenantId, phone } },
    update: name ? { name } : {},
    create: { tenantId, phone, name: name ?? null },
  });
}

export async function issueWebToken(customerId: string, client: DbClient = db): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await client.customer.update({ where: { id: customerId }, data: { webTokenHash: sha256(token) } });
  return token;
}

export async function findCustomerByWebToken(tenantId: string, token: string | undefined) {
  if (!token) return null;
  const customer = await db.customer.findUnique({ where: { webTokenHash: sha256(token) } });
  return customer && customer.tenantId === tenantId ? customer : null;
}

export interface ReturningSuggestion {
  method: DeliveryMethod | null;
  pickupLocation: StoredLocation | null;
  address: (StreetAddress & { id: string }) | null;
}

/** What to offer a returning customer ("Use PEP Jabulani Mall again?"). */
export async function getReturningSuggestion(customerId: string): Promise<ReturningSuggestion | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: { lastPickupLocation: true },
  });
  if (!customer || !customer.rememberPreferences) return null;
  const address = customer.lastAddressId ? await db.customerAddress.findUnique({ where: { id: customer.lastAddressId } }) : null;
  const pickupLocation = customer.lastPickupLocation?.active ? toStoredLocation(customer.lastPickupLocation) : null;
  if (!customer.preferredMethod && !pickupLocation && !address) return null;
  return {
    method: customer.preferredMethod,
    pickupLocation,
    address: address
      ? {
          id: address.id,
          recipientName: address.recipientName,
          phone: address.phone,
          street: address.street,
          complex: address.complex,
          suburb: address.suburb,
          city: address.city,
          province: address.province,
          postcode: address.postcode,
          latitude: address.latitude,
          longitude: address.longitude,
        }
      : null,
  };
}

export async function giveConsent(customerId: string, client: DbClient = db) {
  await client.customer.update({ where: { id: customerId }, data: { rememberPreferences: true, preferencesConsentAt: new Date() } });
}

/** Withdraws consent and deletes everything remembered for convenience. */
export async function forgetPreferences(tenantId: string, customerId: string) {
  await db.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) return;
    await tx.customer.update({
      where: { id: customerId },
      data: {
        rememberPreferences: false,
        preferencesConsentAt: null,
        preferredMethod: null,
        lastPickupLocationId: null,
        lastAddressId: null,
        webTokenHash: null,
      },
    });
    await tx.customerAddress.deleteMany({ where: { customerId, tenantId } });
  });
}

/** Called after an order is placed, only when the customer consented. */
export async function rememberDeliveryChoice(
  client: DbClient,
  customerId: string,
  tenantId: string,
  choice: { method: DeliveryMethod; pickupLocationId: string | null; address: StreetAddress | null },
) {
  const customer = await client.customer.findUnique({ where: { id: customerId } });
  if (!customer?.rememberPreferences) return;

  let lastAddressId = customer.lastAddressId;
  if (choice.address) {
    const a = choice.address;
    const same = await client.customerAddress.findFirst({
      where: { customerId, street: a.street, suburb: a.suburb, city: a.city, postcode: a.postcode },
    });
    const row = same
      ? await client.customerAddress.update({ where: { id: same.id }, data: { lastUsedAt: new Date() } })
      : await client.customerAddress.create({
          data: {
            tenantId,
            customerId,
            recipientName: a.recipientName ?? null,
            phone: a.phone ?? null,
            street: a.street,
            complex: a.complex ?? null,
            suburb: a.suburb,
            city: a.city,
            province: a.province ?? null,
            postcode: a.postcode,
            latitude: a.latitude ?? null,
            longitude: a.longitude ?? null,
          },
        });
    lastAddressId = row.id;
  }

  await client.customer.update({
    where: { id: customerId },
    data: {
      preferredMethod: choice.method,
      lastPickupLocationId: choice.pickupLocationId ?? customer.lastPickupLocationId,
      lastAddressId,
    },
  });
}
