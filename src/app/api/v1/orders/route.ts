import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { listOrders } from "@/server/services/shipments";

export const GET = handle(async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const orders = await listOrders(await requireCurrentUser(), {
    status: (params.get("status") ?? undefined) as never,
    shipmentStatus: params.get("shipmentStatus") ?? undefined,
  });
  return NextResponse.json({ orders });
});
