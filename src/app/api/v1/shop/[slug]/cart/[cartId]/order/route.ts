import { NextRequest, NextResponse } from "next/server";
import { CUSTOMER_COOKIE_NAME, resolveShop, secureCookies } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { placeOrder } from "@/server/services/checkout";
import { issueWebToken } from "@/server/services/customers";

export const POST = handle(async (request: NextRequest, { params }: { params: Promise<{ slug: string; cartId: string }> }) => {
  const { slug, cartId } = await params;
  const shop = await resolveShop(slug);
  const body = await request.json();
  const { order, paymentUrl } = await placeOrder(shop.id, cartId, body);
  const response = NextResponse.json({ order: { id: order.id, number: order.number, totalCents: order.totalCents }, paymentUrl }, { status: 201 });
  // Remember this browser only when the customer opted in, so saved
  // delivery details are offered back to this device alone.
  if (body.rememberPreferences === true) {
    response.cookies.set({
      name: CUSTOMER_COOKIE_NAME,
      value: await issueWebToken(order.customerId),
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: 365 * 24 * 3600,
    });
  }
  return response;
});
