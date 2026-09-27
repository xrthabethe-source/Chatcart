import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handle } from "@/server/http/respond";
import { UnauthenticatedError } from "@/server/services/errors";
import { dispatchOutbox } from "@/server/services/notifications";
import { syncAllTracking } from "@/server/services/shipments";

// Cron: refresh courier tracking for active shipments, then flush the
// notification outbox. Call every 15–30 minutes with
// "Authorization: Bearer $CRON_SECRET".
export const POST = handle(async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    throw new UnauthenticatedError();
  }
  const tracking = await syncAllTracking();
  const outbox = await dispatchOutbox();
  return NextResponse.json({ tracking, outbox });
});
