import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { listCatalogueForShop, setCatalogueSelection } from "@/server/services/catalogue";

export const GET = handle(async () => NextResponse.json({ products: await listCatalogueForShop(await requireCurrentUser()) }));

export const PUT = handle(async (request: NextRequest) =>
  NextResponse.json({ products: await setCatalogueSelection(await requireCurrentUser(), await request.json()) }),
);
