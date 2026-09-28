import Link from "next/link";
import { requireCurrentUser } from "@/server/http/context";
import type { Destination } from "@/server/delivery/types";
import { listOrders } from "@/server/services/shipments";
import { getOnboardingStatus } from "@/server/services/onboarding";
import { ShareCard } from "../_components/share-card";
import { dateTime, localPhone, rands } from "../../_lib/format";
import { MethodChip, shortDestination, StatusChip } from "../_components/delivery-bits";

const TABS = [
  { key: "all", label: "All", filter: {} },
  { key: "unpaid", label: "Awaiting payment", filter: { status: "PENDING_PAYMENT" } },
  { key: "book", label: "Ready to book", filter: { shipmentStatus: "READY_TO_BOOK" } },
  { key: "paxi", label: "Ready for PAXI registration", filter: { shipmentStatus: "READY_FOR_REGISTRATION" } },
  { key: "transit", label: "On the way", filter: { status: "SHIPPED" } },
  { key: "exception", label: "Problems", filter: { shipmentStatus: "EXCEPTION" } },
  { key: "done", label: "Completed", filter: { status: "COMPLETED" } },
] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireCurrentUser();
  const tabKey = (await searchParams).tab ?? "all";
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0];
  const [orders, onboarding] = await Promise.all([listOrders(user, tab.filter as never), getOnboardingStatus(user)]);

  return (
    <main className="container stack">
      <ShareCard shopUrl={onboarding.shopUrl} shareText={onboarding.shareText} whatsappShareUrl={onboarding.whatsappShareUrl} steps={onboarding.steps} whatsappConnected={onboarding.whatsappConnected} whatsappConnectAvailable={onboarding.whatsappConnectAvailable} />
      <div className="spread">
        <h1>Orders</h1>
        {tab.key === "paxi" && orders.length > 0 && (
          <a className="btn" href="/api/v1/shipments/paxi-registration" download>Export for PAXI portal (CSV)</a>
        )}
      </div>
      <nav className="tabs" aria-label="Order filters">
        {TABS.map((t) => (
          <Link key={t.key} href={`/dashboard/orders?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>{t.label}</Link>
        ))}
      </nav>
      {tab.key === "paxi" && (
        <p className="muted small">
          These paid orders go to a PAXI Point, but your shop isn&apos;t connected to the PAXI API yet. Register each parcel on the
          PAXI portal (export the CSV or copy the details from the order), then enter the PAXI reference on the order.
        </p>
      )}
      <div className="card table-wrap">
        {orders.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No orders here yet.</p>
        ) : (
          <table className="stack-on-phone">
            <thead>
              <tr><th>Order</th><th>Customer</th><th>Delivery</th><th>Courier status</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const shipment = o.shipments[0];
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/dashboard/orders/${o.id}`}><strong>{o.number}</strong></Link>
                      <div className="small muted">{dateTime(o.createdAt)}</div>
                    </td>
                    <td data-label="Customer">{o.customer.name ?? "—"}<div className="small muted">{localPhone(o.customer.phone)}</div></td>
                    <td data-label="Delivery">
                      <MethodChip method={o.deliveryMethod} />
                      <div className="small">{shortDestination(o.deliveryDestination as unknown as Destination)}</div>
                    </td>
                    <td data-label="Status">
                      {o.status === "PENDING_PAYMENT" ? <span className="chip">Awaiting payment</span> : shipment ? <StatusChip status={shipment.status} /> : "—"}
                      {shipment?.trackingNumber && <div className="small mono">{shipment.trackingNumber}</div>}
                    </td>
                    <td className="num" data-label="Total">{rands(o.totalCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
