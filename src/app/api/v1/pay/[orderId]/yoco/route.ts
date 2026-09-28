import { NextResponse } from "next/server";
import { handle } from "@/server/http/respond";
import { startYocoCheckout } from "@/server/services/payments";

export const POST = handle(async (_request: Request, { params }: { params: Promise<{ orderId: string }> }) =>
  NextResponse.json(await startYocoCheckout((await params).orderId)),
);
