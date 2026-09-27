import { requireCurrentUser } from "@/server/http/context";
import { getShopSettings } from "@/server/services/shop-settings";
import { ShopSettingsForm } from "./shop-settings-form";

export default async function ShopSettingsPage() {
  const settings = await getShopSettings(await requireCurrentUser());
  return (
    <main className="container stack">
      <h1>Shop settings</h1>
      <ShopSettingsForm initial={settings} />
    </main>
  );
}
