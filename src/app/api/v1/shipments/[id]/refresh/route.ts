import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { refreshTrackingForSeller } from "@/server/services/shipments";

export const POST = handle(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return NextResponse.json({ order: await refreshTrackingForSeller(await requireCurrentUser(), id) });
});
