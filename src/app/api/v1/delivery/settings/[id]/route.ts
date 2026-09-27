import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { updateDeliveryProvider } from "@/server/services/delivery-settings";

export const PATCH = handle(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ provider: await updateDeliveryProvider(await requireCurrentUser(), id, await request.json()) });
});
