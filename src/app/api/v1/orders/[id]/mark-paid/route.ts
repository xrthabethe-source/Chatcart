import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { markOrderPaid } from "@/server/services/checkout";
import { getOrderDetail } from "@/server/services/shipments";

// Seller records an EFT/cash payment by hand.
export const POST = handle(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const user = await requireCurrentUser();
  const body = await request.json().catch(() => ({}));
  await markOrderPaid(user.tenantId, id, typeof body.reference === "string" ? body.reference.slice(0, 100) : "manual");
  return NextResponse.json({ order: await getOrderDetail(user, id) });
});
