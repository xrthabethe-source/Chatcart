import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { shippingDetailsText } from "@/server/services/shipments";

export const GET = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ text: await shippingDetailsText(await requireCurrentUser(), id) });
});
