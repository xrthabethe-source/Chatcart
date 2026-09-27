import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { importLocations } from "@/server/services/locations";

// Platform admin: load/refresh the pickup-point directory used in
// ASSISTED mode, e.g. { "providerCode": "PAXI", "locations": [...] }.
export const POST = handle(async (request: NextRequest) => {
  await requirePlatformAdmin();
  return NextResponse.json(await importLocations(await request.json()));
});
