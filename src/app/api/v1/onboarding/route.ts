import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { getOnboardingStatus } from "@/server/services/onboarding";

export const GET = handle(async () => NextResponse.json({ status: await getOnboardingStatus(await requireCurrentUser()) }));
