import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { setupQuickDelivery } from "@/server/services/onboarding";

export const POST = handle(async (request: NextRequest) =>
  NextResponse.json({ status: await setupQuickDelivery(await requireCurrentUser(), await request.json()) }),
);
