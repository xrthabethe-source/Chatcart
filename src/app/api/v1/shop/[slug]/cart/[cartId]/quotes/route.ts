import { NextRequest, NextResponse } from "next/server";
import { resolveShop } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { quoteDelivery } from "@/server/services/checkout";

export const POST = handle(async (request: NextRequest, { params }: { params: Promise<{ slug: string; cartId: string }> }) => {
  const { slug, cartId } = await params;
  const shop = await resolveShop(slug);
  return NextResponse.json(await quoteDelivery(shop.id, cartId, await request.json()));
});
