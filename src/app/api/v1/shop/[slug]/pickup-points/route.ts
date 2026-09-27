import { NextRequest, NextResponse } from "next/server";
import { resolveShop } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { searchPickupPoints } from "@/server/services/locations";

export const POST = handle(async (request: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const shop = await resolveShop((await params).slug);
  return NextResponse.json({ points: await searchPickupPoints(shop.id, await request.json()) });
});
