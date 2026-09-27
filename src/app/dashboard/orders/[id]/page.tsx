import Link from "next/link";
import { requireCurrentUser } from "@/server/http/context";
import { courierLabel } from "@/server/delivery/messages";
import { getOrderDetail } from "@/server/services/shipments";
import { dateTime, localPhone, rands } from "../../../_lib/format";
import { MethodChip, StatusChip } from "../../_components/delivery-bits";
import { ShipmentActionsPanel } from "./shipment-actions";
import { MarkPaidButton } from "./mark-paid";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCurrentUser();
  const order = await getOrderDetail(user, (await params).id);
  const d = order.destination;
  const shipment = order.shipments[0];
  const paid = order.status !== "PENDING_PAYMENT" && order.status !== "CANCELLED";

  return (
    <main className="container stack">
      <Link href="/dashboard/orders" className="small">← Orders</Link>
      <div className="spread">
        <h1>ORDER {order.number}</h1>
        <div className="row">
          <MethodChip method={order.deliveryMethod} />
          {shipment && paid && <StatusChip status={shipment.status} />}
        </div>
      </div>

      {/* Destination first: it's what the seller needs to ship. */}
      {d.kind === "PICKUP_POINT" ? (
        <div className="paxi-banner" aria-label="PAXI destination">
          <div className="small" style={{ fontWeight: 700, letterSpacing: "0.05em" }}>{order.deliveryProvider.code === "PAXI" ? "PAXI" : order.deliveryProvider.name}</div>
          <div className="big">{d.location.name}</div>
          <div className="mono">
            {d.location.code ? `Point code: ${d.location.code} · ` : ""}Location ID: {d.location.externalId}
          </div>
          <div className="small muted">{[d.location.address, d.location.suburb, d.location.city, d.location.province, d.location.postcode].filter(Boolean).join(", ")}</div>
        </div>
      ) : d.kind === "ADDRESS" ? (
        <div className="card">
          <h2>Deliver to</h2>
          <address style={{ fontStyle: "normal" }}>
            {d.address.recipientName && <div><strong>{d.address.recipientName}</strong></div>}
            {d.address.complex && <div>{d.address.complex}</div>}
            <div>{d.address.street}</div>
            <div>{d.address.suburb}</div>
            <div>{d.address.city}{d.address.province ? `, ${d.address.province}` : ""}</div>
            <div>{d.address.postcode}</div>
          </address>
        </div>
      ) : (
        <div className="card">
          <h2>Customer collects from you</h2>
          {d.instructions && <p className="muted">{d.instructions}</p>}
        </div>
      )}

      <div className="grid-2">
        <section className="card stack" aria-labelledby="customer-h">
          <h2 id="customer-h">Customer</h2>
          <div><strong>{order.customer.name ?? "—"}</strong></div>
          <div>{localPhone(order.customer.phone)}{order.customer.email ? ` · ${order.customer.email}` : ""}</div>
          <div className="row">
            <a className="btn btn-sm" href={`https://wa.me/${order.customer.phone}?text=${encodeURIComponent(`Hi, about your order ${order.number}: `)}`} target="_blank" rel="noreferrer">
              Message customer
            </a>
          </div>
        </section>

        <section className="card stack" aria-labelledby="payment-h">
          <h2 id="payment-h">Payment</h2>
          <div className="totals">
            <div><span>Products</span><span className="price">{rands(order.subtotalCents)}</span></div>
            <div><span>Delivery ({courierLabel(order.deliveryProvider.code, order.deliveryProvider.name)} · {order.deliveryServiceCode})</span><span className="price">{order.shippingCents === 0 ? "FREE" : rands(order.shippingCents)}</span></div>
            <div className="total"><span>Total</span><span>{rands(order.totalCents)}</span></div>
          </div>
          {order.paidAt ? (
            <div className="alert alert-ok small">Paid {dateTime(order.paidAt)}{order.paymentRef ? ` · ref ${order.paymentRef}` : ""}</div>
          ) : (
            <MarkPaidButton orderId={order.id} />
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="products-h">
        <h2 id="products-h">Products</h2>
        <table>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}><td>{i.quantity} × {i.name}</td><td className="num">{rands(i.unitPriceCents * i.quantity)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {shipment && (
        <section className="card stack" aria-labelledby="shipment-h">
          <div className="spread">
            <h2 id="shipment-h">Delivery</h2>
            <span className="small muted">{shipment.provider.name} · {shipment.mode === "ASSISTED" ? "assisted dispatch" : "integrated"}</span>
          </div>
          <div className="row small">
            <span>Courier: <strong>{courierLabel(shipment.provider.code, shipment.provider.name)}</strong></span>
            <span>Tracking number: <strong className="mono">{shipment.trackingNumber ?? "—"}</strong></span>
            <span>Parcel: {shipment.parcelLengthCm}×{shipment.parcelWidthCm}×{shipment.parcelHeightCm} cm, {(shipment.parcelWeightGrams / 1000).toFixed(2)} kg</span>
          </div>
          {paid ? (
            <ShipmentActionsPanel
              shipmentId={shipment.id}
              providerCode={shipment.provider.code}
              actions={shipment.actions}
              labelUrl={shipment.labelUrl}
              trackingUrl={shipment.trackingUrl}
            />
          ) : (
            <p className="muted small">Delivery actions unlock once the order is paid.</p>
          )}
          {shipment.events.length > 0 && (
            <>
              <h3>Tracking history</h3>
              <ol className="timeline">
                {shipment.events.map((e) => (
                  <li key={e.id}>
                    <div><strong>{e.description}</strong>{e.location ? ` · ${e.location}` : ""}</div>
                    <div className="small muted">{dateTime(e.occurredAt)} · {e.source === "PROVIDER" ? "from courier" : e.source === "SELLER" ? "by you" : "system"}</div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
    </main>
  );
}
