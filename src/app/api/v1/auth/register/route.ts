import { NextRequest, NextResponse } from "next/server";
import { sessionCookie } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { registerSeller } from "@/server/services/auth";

export const POST = handle(async (request: NextRequest) => {
  const { tenant, sessionToken } = await registerSeller(await request.json());
  const response = NextResponse.json({ shop: { id: tenant.id, name: tenant.name, slug: tenant.slug } }, { status: 201 });
  response.cookies.set(sessionCookie(sessionToken));
  return response;
});
