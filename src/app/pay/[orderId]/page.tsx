import { notFound } from "next/navigation";
import { destinationLabel } from "@/server/delivery/messages";
import { getOrderForPayment } from "@/server/services/checkout";
import { NotFoundError } from "@/server/services/errors";
import { rands } from "../../_lib/format";
import { SimulatePayment } from "./simulate";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ orderId: string }> }) {
  let order;
  try {
    order = await getOrderForPayment((await params).orderId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const paid = order.status !== "PENDING_PAYMENT";
  return (
    <main className="narrow stack">
      <h1>Order {order.number}</h1>
      <p className="muted">{order.shopName}</p>
      <div className="card totals">
        {order.items.map((i, idx) => <div key={idx}><span>{i.quantity} × {i.name}</span><span className="price">{rands(i.lineCents)}</span></div>)}
        <div><span>Delivery</span><span className="price">{order.shippingCents === 0 ? "FREE" : rands(order.shippingCents)}</span></div>
        <div className="total"><span>TOTAL</span><span>{rands(order.totalCents)}</span></div>
        <div className="small muted" style={{ display: "block" }}>{order.destination.kind === "PICKUP_POINT" ? "Collect at " : ""}{destinationLabel(order.destination)}</div>
      </div>
      {paid ? (
        <div className="alert alert-ok">Paid — thank you! We&apos;ll send delivery updates on WhatsApp. Send TRACK to the shop&apos;s WhatsApp at any time.</div>
      ) : process.env.APP_ENV === "development" ? (
        <SimulatePayment orderId={order.id} />
      ) : (
        <div className="alert alert-warn">Online payment isn&apos;t connected for this shop yet. Please contact the seller to pay by EFT.</div>
      )}
    </main>
  );
}
