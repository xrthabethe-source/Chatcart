import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { getDefaultPaxiTariff, setDefaultPaxiTariff } from "@/server/services/platform-settings";

export const GET = handle(async () => {
  await requirePlatformAdmin();
  return NextResponse.json({ tariff: await getDefaultPaxiTariff() });
});

export const PUT = handle(async (request: NextRequest) => {
  await requirePlatformAdmin();
  return NextResponse.json({ tariff: await setDefaultPaxiTariff((await request.json()).tariff) });
});
