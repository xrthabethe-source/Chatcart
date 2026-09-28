import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { getPaymentSettings, setPaymentInstructions } from "@/server/services/payments";

export const GET = handle(async () => NextResponse.json({ payments: await getPaymentSettings(await requireCurrentUser()) }));

// { paymentInstructions } — EFT / cash details shown on the payment page.
export const PATCH = handle(async (request: NextRequest) => {
  const user = await requireCurrentUser();
  await setPaymentInstructions(user, await request.json());
  return NextResponse.json({ payments: await getPaymentSettings(user) });
});
