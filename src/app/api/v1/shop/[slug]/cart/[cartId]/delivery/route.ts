import { NextRequest, NextResponse } from "next/server";
import { resolveShop } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { selectDeliveryQuote } from "@/server/services/checkout";

export const PUT = handle(async (request: NextRequest, { params }: { params: Promise<{ slug: string; cartId: string }> }) => {
  const { slug, cartId } = await params;
  const shop = await resolveShop(slug);
  const body = await request.json();
  return NextResponse.json({ cart: await selectDeliveryQuote(shop.id, cartId, String(body.quoteId)) });
});
