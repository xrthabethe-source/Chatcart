import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../db.ts";
import { ForbiddenError, ValidationError } from "./errors.ts";
import { getShopSettings, updateShopSettings } from "./shop-settings.ts";
import { createSeller } from "./test-helpers.ts";

after(() => db.$disconnect());

const noLookup = async () => null;

test("sellers can change their shop name, display name and order prefix", async () => {
  const { user } = await createSeller("settings-shop");
  await updateShopSettings(user, { name: "Sandile's Sweets", sellerDisplayName: "Sandile", orderPrefix: "cc" }, noLookup);
  const s = await getShopSettings(user);
  assert.deepEqual([s.name, s.sellerDisplayName, s.orderPrefix], ["Sandile's Sweets", "Sandile", "CC"]);
  await assert.rejects(() => updateShopSettings(user, { orderPrefix: "C-1" }, noLookup), ValidationError);
});

test("only platform admins can link a WhatsApp number, and a number can't be linked twice", async () => {
  const a = await createSeller("wa-link-a");
  const b = await createSeller("wa-link-b");
  const phoneId = String(Date.now()).slice(-12);

  await assert.rejects(() => updateShopSettings(a.user, { whatsappPhoneId: phoneId }, noLookup), ForbiddenError);

  const previous = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_ADMIN_EMAILS = `${a.user.email},${b.user.email}`;
  try {
    const res = await updateShopSettings(a.user, { whatsappPhoneId: phoneId }, async () => ({ displayPhoneNumber: "+27 82 000 0000", verifiedName: "Shop" }));
    assert.equal(res.whatsappPhoneId, phoneId);
    assert.equal(res.linkedNumber, "+27 82 000 0000");
    await assert.rejects(() => updateShopSettings(b.user, { whatsappPhoneId: phoneId }, noLookup), /already linked/);
    await assert.rejects(() => updateShopSettings(a.user, { whatsappPhoneId: "+27820000000" }, noLookup), /phone number ID/);
    // Unlinking frees it.
    await updateShopSettings(a.user, { whatsappPhoneId: null }, noLookup);
    assert.equal((await updateShopSettings(b.user, { whatsappPhoneId: phoneId }, noLookup)).whatsappPhoneId, phoneId);
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previous;
  }
});
