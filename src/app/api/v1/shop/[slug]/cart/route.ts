import { NextRequest, NextResponse } from "next/server";
import { resolveShop } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { createCart, setCartItem } from "@/server/services/checkout";

// Creates a cart with its first items: { items: [{ productId, quantity }] }.
// The cart id (a random UUID) is the customer's handle to it.
export const POST = handle(async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const shop = await resolveShop((await params).slug);
  const body = await request.json();
  const cart = await createCart(shop.id, "WEB");
  let view = null;
  for (const item of Array.isArray(body.items) ? body.items.slice(0, 50) : []) {
    view = await setCartItem(shop.id, cart.id, String(item.productId), Number(item.quantity));
  }
  return NextResponse.json({ cartId: cart.id, cart: view }, { status: 201 });
});
