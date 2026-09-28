import { NextRequest, NextResponse } from "next/server";
import { sessionCookie } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { checkInvite, joinWithInvite } from "@/server/services/invites";

type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (_request: NextRequest, { params }: Ctx) => NextResponse.json({ invite: await checkInvite((await params).token) }));

export const POST = handle(async (request: NextRequest, { params }: Ctx) => {
  const { sessionToken } = await joinWithInvite((await params).token, await request.json());
  const response = NextResponse.json({ ok: true }, { status: 201 });
  response.cookies.set(sessionCookie(sessionToken));
  return response;
});
