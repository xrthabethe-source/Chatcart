import { NextRequest, NextResponse } from "next/server";
import { handle } from "@/server/http/respond";
import { logout, SESSION_COOKIE_NAME } from "@/server/services/auth";

export const POST = handle(async (request: NextRequest) => {
  await logout(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
});
