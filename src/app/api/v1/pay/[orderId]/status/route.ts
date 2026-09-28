import { NextResponse } from "next/server";
import { handle } from "@/server/http/respond";
import { getOrderForPayment } from "@/server/services/checkout";

export const dynamic = "force-dynamic";

export const GET = handle(async (_request: Request, { params }: { params: Promise<{ orderId: string }> }) => {
  const order = await getOrderForPayment((await params).orderId);
  return NextResponse.json({ status: order.status });
});
