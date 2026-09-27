import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { createProduct, listProducts } from "@/server/services/products";

export const GET = handle(async () => NextResponse.json({ products: await listProducts(await requireCurrentUser()) }));

export const POST = handle(async (request: NextRequest) => {
  const product = await createProduct(await requireCurrentUser(), await request.json());
  return NextResponse.json({ product }, { status: 201 });
});
