import { NextRequest, NextResponse } from "next/server";
import { sessionCookie } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { login } from "@/server/services/auth";

export const POST = handle(async (request: NextRequest) => {
  const body = await request.json();
  const { sessionToken } = await login(body.email, body.password);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(sessionToken));
  return response;
});
