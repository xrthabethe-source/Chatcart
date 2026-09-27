import { z } from "zod";
import { db } from "../db.ts";
import type { AuthenticatedUser } from "./auth.ts";
import { ConflictError, NotFoundError, ValidationError, zodMessage } from "./errors.ts";

const positiveOrNull = (max: number) => z.number().int().min(1).max(max).nullable().optional();

export const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
  description: z.string().trim().max(2000).nullable().optional(),
  priceCents: z.number().int().min(0).max(100_000_000),
  active: z.boolean().optional(),
  weightGrams: positiveOrNull(100_000),
  lengthCm: positiveOrNull(300),
  widthCm: positiveOrNull(300),
  heightCm: positiveOrNull(300),
  shippingCategory: z.enum(["STANDARD", "FRAGILE", "PERISHABLE", "OVERSIZED"]).optional(),
});
export type ProductInput = z.input<typeof productSchema>;

export async function createProduct(user: AuthenticatedUser, input: ProductInput) {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  try {
    return await db.product.create({ data: { tenantId: user.tenantId, ...parsed.data } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new ConflictError("A product with this SKU already exists.");
    throw error;
  }
}

export async function updateProduct(user: AuthenticatedUser, id: string, input: Partial<ProductInput>) {
  const parsed = productSchema.partial().safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const existing = await db.product.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!existing) throw new NotFoundError("Product");
  return db.product.update({ where: { id }, data: parsed.data });
}

export async function listProducts(user: AuthenticatedUser) {
  return db.product.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: "asc" } });
}

/** Storefront / WhatsApp catalogue. */
export async function listActiveProducts(tenantId: string) {
  return db.product.findMany({ where: { tenantId, active: true }, orderBy: { name: "asc" } });
}

/**
 * Best match for a product mentioned in chat ("2 Product A", "honey
 * sticks"): exact name, then SKU, then every word contained in the name.
 */
export async function findProductByText(tenantId: string, text: string) {
  const products = await listActiveProducts(tenantId);
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return (
    products.find((p) => p.name.toLowerCase() === t) ??
    products.find((p) => p.sku?.toLowerCase() === t) ??
    products.find((p) => t.split(/\s+/).every((w) => p.name.toLowerCase().includes(w))) ??
    null
  );
}
