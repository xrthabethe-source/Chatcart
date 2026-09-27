import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { getShopSettings, updateShopSettings } from "@/server/services/shop-settings";

export const GET = handle(async () => NextResponse.json({ settings: await getShopSettings(await requireCurrentUser()) }));

export const PATCH = handle(async (request: NextRequest) =>
  NextResponse.json({ settings: await updateShopSettings(await requireCurrentUser(), await request.json()) }),
);
