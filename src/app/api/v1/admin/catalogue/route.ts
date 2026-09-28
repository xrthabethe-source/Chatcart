import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/server/http/context";
import { handle } from "@/server/http/respond";
import { importMasterCatalogue, parseCatalogueCsv } from "@/server/services/catalogue";

// { csv: "sku,name,price,…" } or { products: [...] }, plus optional
// deactivateMissing.
export const POST = handle(async (request: NextRequest) => {
  await requirePlatformAdmin();
  const body = await request.json();
  const products = typeof body.csv === "string" ? parseCatalogueCsv(body.csv) : body.products;
  return NextResponse.json(await importMasterCatalogue({ products, deactivateMissing: body.deactivateMissing === true }));
});
