import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { listDeliverySettings } from "@/server/services/delivery-settings";

export const GET = handle(async () => NextResponse.json({ providers: await listDeliverySettings(await requireCurrentUser()) }));
