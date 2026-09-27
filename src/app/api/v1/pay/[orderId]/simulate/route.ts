import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { handle } from "@/server/http/respond";
import { markOrderPaid } from "@/server/services/checkout";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";

// Development only: stands in for a payment gateway's success webhook.
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ orderId: string }> }) => {
  if (process.env.APP_ENV !== "development") throw new ForbiddenError("Payment simulation is disabled.");
  const { orderId } = await params;
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Order");
  await markOrderPaid(order.tenantId, order.id, "simulated");
  return NextResponse.json({ ok: true });
});
