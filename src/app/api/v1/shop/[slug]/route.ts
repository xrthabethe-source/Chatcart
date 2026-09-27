import { NextRequest, NextResponse } from "next/server";
import { CUSTOMER_COOKIE_NAME, resolveShop } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { getDeliveryMethods } from "@/server/services/checkout";
import { findCustomerByWebToken, getReturningSuggestion } from "@/server/services/customers";
import { listActiveProducts } from "@/server/services/products";

export const GET = handle(async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const shop = await resolveShop((await params).slug);
  const customer = await findCustomerByWebToken(shop.id, request.cookies.get(CUSTOMER_COOKIE_NAME)?.value);
  return NextResponse.json({
    shop: { name: shop.name, slug: shop.slug },
    products: (await listActiveProducts(shop.id)).map((p) => ({ id: p.id, name: p.name, description: p.description, priceCents: p.priceCents })),
    deliveryMethods: await getDeliveryMethods(shop.id),
    returning: customer ? { name: customer.name, phone: customer.phone, suggestion: await getReturningSuggestion(customer.id) } : null,
  });
});
