import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { addSameDayProvider, listDeliveryProviderCatalogue } from "@/server/services/delivery-catalogue";

export const GET = handle(async () => {
  await requirePlatformAdmin();
  return NextResponse.json({ providers: await listDeliveryProviderCatalogue() });
});

// Register an additional same-day courier (local-courier contract).
export const POST = handle(async (request: NextRequest) => {
  await requirePlatformAdmin();
  return NextResponse.json({ provider: await addSameDayProvider(await request.json()) }, { status: 201 });
});
