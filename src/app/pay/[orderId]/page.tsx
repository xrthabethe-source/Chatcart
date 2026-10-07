import { notFound } from "next/navigation";
import { destinationLabel } from "@/server/delivery/messages";
import { getOrderForPayment } from "@/server/services/checkout";
import { NotFoundError } from "@/server/services/errors";
import { rands } from "../../_lib/format";
import { PayActions } from "./pay-actions";
import { SiteFooter } from "../../_lib/site-footer";

export const dynamic = "force-dynamic";

export default async function PayPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ result?: string }> }) {
  let order;
  try {
    order = await getOrderForPayment((await params).orderId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const result = (await searchParams).result ?? null;
  return (
    <main className="narrow stack">
      <div>
        <h1>Order {order.number}</h1>
        <p className="muted">{order.shopName}</p>
      </div>
      <div className="card totals">
        {order.items.map((i, idx) => <div key={idx}><span>{i.quantity} × {i.name}</span><span className="price">{rands(i.lineCents)}</span></div>)}
        <div><span>Delivery</span><span className="price">{order.shippingCents === 0 ? "FREE" : rands(order.shippingCents)}</span></div>
        <div className="total"><span>TOTAL</span><span>{rands(order.totalCents)}</span></div>
        <div className="small muted" style={{ display: "block" }}>{order.destination.kind === "PICKUP_POINT" ? "Collect at " : ""}{destinationLabel(order.destination)}</div>
      </div>
      <PayActions
        orderId={order.id}
        orderNumber={order.number}
        initiallyPaid={order.status !== "PENDING_PAYMENT"}
        result={result}
        cardPayments={order.cardPayments}
        paymentInstructions={order.paymentInstructions}
        sellerName={order.sellerName}
        sellerWhatsAppUrl={order.sellerWhatsAppUrl}
        simulate={process.env.APP_ENV === "development"}
      />
      <SiteFooter seller={{ shopName: order.shopName, whatsappNumber: order.sellerWhatsAppNumber, cardPayments: order.cardPayments }} />
    </main>
  );
}
