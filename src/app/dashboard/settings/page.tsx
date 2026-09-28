import { requireCurrentUser } from "@/server/http/context";
import { getShopSettings } from "@/server/services/shop-settings";
import { getWhatsAppConnection, whatsappConnectConfig } from "@/server/services/whatsapp-connect";
import { ShopSettingsForm } from "./shop-settings-form";

export default async function ShopSettingsPage() {
  const user = await requireCurrentUser();
  const [settings, connection] = await Promise.all([getShopSettings(user), getWhatsAppConnection(user, true)]);
  const { appId, configId } = whatsappConnectConfig();
  return (
    <main className="container stack">
      <h1>Shop settings</h1>
      <ShopSettingsForm initial={settings} connect={{ ...connection, appId, configId }} />
    </main>
  );
}
