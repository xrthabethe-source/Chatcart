import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { connectYoco, disconnectYoco } from "@/server/services/payments";

export const POST = handle(async (request: NextRequest) =>
  NextResponse.json({ yoco: await connectYoco(await requireCurrentUser(), await request.json()) }),
);

export const DELETE = handle(async () => {
  await disconnectYoco(await requireCurrentUser());
  return NextResponse.json({ ok: true });
});
