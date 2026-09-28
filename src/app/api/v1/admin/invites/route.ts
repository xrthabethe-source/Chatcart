import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { createInvite, listInvites } from "@/server/services/invites";

export const GET = handle(async () => NextResponse.json({ invites: await listInvites(await requirePlatformAdmin()) }));

export const POST = handle(async (request: NextRequest) =>
  NextResponse.json({ invite: await createInvite(await requirePlatformAdmin(), await request.json()) }, { status: 201 }),
);
