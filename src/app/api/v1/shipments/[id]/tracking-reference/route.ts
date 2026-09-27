import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { enterTrackingReference } from "@/server/services/shipments";

export const POST = handle(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ order: await enterTrackingReference(await requireCurrentUser(), id, await request.json()) });
});
