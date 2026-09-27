import { requireCurrentUser } from "@/server/http/context";
import { listDeliverySettings } from "@/server/services/delivery-settings";
import { DeliverySettings } from "./delivery-settings";

export default async function DeliverySettingsPage() {
  const user = await requireCurrentUser();
  const providers = await listDeliverySettings(user);
  return (
    <main className="container stack">
      <h1>Delivery settings</h1>
      <p className="muted">
        Choose how customers can receive their orders. At checkout they&apos;ll only see the options you switch on here, with
        prices worked out from your rules below.
      </p>
      <DeliverySettings providers={JSON.parse(JSON.stringify(providers))} />
    </main>
  );
}
