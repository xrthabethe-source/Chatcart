// Shared brand catalogue (e.g. the APLGO range).
//
// A platform admin loads it once; each associate ticks what they stock,
// which copies those products into their shop. Name, description, photo
// and parcel size stay in sync with the catalogue on every re-import;
// the price is the recommended retail price and each associate can set
// their own afterwards.
import { z } from "zod";
import { db } from "../db.ts";
import type { AuthenticatedUser } from "./auth.ts";
import { ValidationError, zodMessage } from "./errors.ts";

const optionalInt = (max: number) => z.number().int().min(1).max(max).nullable().optional();

export const masterProductSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  imageUrl: z.string().trim().url().nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  priceCents: z.number().int().min(0).max(100_000_000),
  weightGrams: optionalInt(100_000),
  lengthCm: optionalInt(300),
  widthCm: optionalInt(300),
  heightCm: optionalInt(300),
  shippingCategory: z.enum(["STANDARD", "FRAGILE", "PERISHABLE", "OVERSIZED"]).optional(),
});

export const importCatalogueSchema = z.object({
  products: z.array(masterProductSchema).min(1).max(2000),
  // Hide catalogue products missing from this import (a full refresh).
  deactivateMissing: z.boolean().default(false),
});

/** Platform admin: create/update catalogue products by SKU. */
export async function importMasterCatalogue(input: z.input<typeof importCatalogueSchema>) {
  const parsed = importCatalogueSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const skus = new Set<string>();
  for (const p of parsed.data.products) {
    if (skus.has(p.sku)) throw new ValidationError(`SKU ${p.sku} appears twice.`);
    skus.add(p.sku);
  }

  let created = 0;
  let updated = 0;
  await db.$transaction(async (tx) => {
    for (const [index, p] of parsed.data.products.entries()) {
      const data = {
        name: p.name,
        description: p.description ?? null,
        imageUrl: p.imageUrl ?? null,
        category: p.category ?? null,
        priceCents: p.priceCents,
        weightGrams: p.weightGrams ?? null,
        lengthCm: p.lengthCm ?? null,
        widthCm: p.widthCm ?? null,
        heightCm: p.heightCm ?? null,
        shippingCategory: p.shippingCategory ?? "STANDARD",
        active: true,
        sortOrder: index,
      };
      const existing = await tx.masterProduct.findUnique({ where: { sku: p.sku } });
      const master = existing
        ? await tx.masterProduct.update({ where: { id: existing.id }, data })
        : await tx.masterProduct.create({ data: { sku: p.sku, ...data } });
      if (existing) updated++;
      else created++;
      // Keep associates' copies in step (never their price).
      await tx.product.updateMany({
        where: { masterProductId: master.id },
        data: {
          name: data.name,
          description: data.description,
          imageUrl: data.imageUrl,
          weightGrams: data.weightGrams,
          lengthCm: data.lengthCm,
          widthCm: data.widthCm,
          heightCm: data.heightCm,
          shippingCategory: data.shippingCategory,
        },
      });
    }
    if (parsed.data.deactivateMissing) {
      await tx.masterProduct.updateMany({ where: { sku: { notIn: [...skus] } }, data: { active: false } });
    }
  });
  return { created, updated };
}

/**
 * Parses a catalogue CSV (header row required). Columns: sku, name,
 * price (rands), description, image_url, category, weight_g, length_cm,
 * width_cm, height_cm. Returns rows ready for importMasterCatalogue.
 */
export function parseCatalogueCsv(text: string) {
  const rows = parseCsv(text.trim());
  if (rows.length < 2) throw new ValidationError("The CSV needs a header row and at least one product.");
  const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  for (const required of ["sku", "name", "price"]) {
    if (col(required) < 0) throw new ValidationError(`The CSV is missing a "${required}" column.`);
  }
  const int = (v: string | undefined) => (v && v.trim() ? Math.round(Number(v)) : null);
  return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r, i) => {
    const get = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
    const price = Number(get("price").replace(/^R\s*/i, "").replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(price) || price < 0) throw new ValidationError(`Row ${i + 2}: "${get("price")}" isn't a valid price.`);
    return {
      sku: get("sku"),
      name: get("name"),
      priceCents: Math.round(price * 100),
      description: get("description") || null,
      imageUrl: get("image_url") || null,
      category: get("category") || null,
      weightGrams: int(get("weight_g")),
      lengthCm: int(get("length_cm")),
      widthCm: int(get("width_cm")),
      heightCm: int(get("height_cm")),
    };
  });
}

// Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and
// newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/** The catalogue as an associate sees it, with what they already stock. */
export async function listCatalogueForShop(user: AuthenticatedUser) {
  const [masters, mine] = await Promise.all([
    db.masterProduct.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.product.findMany({ where: { tenantId: user.tenantId, masterProductId: { not: null } } }),
  ]);
  const byMaster = new Map(mine.map((p) => [p.masterProductId!, p]));
  return masters.map((m) => {
    const own = byMaster.get(m.id);
    return {
      id: m.id,
      sku: m.sku,
      name: m.name,
      description: m.description,
      imageUrl: m.imageUrl,
      category: m.category,
      recommendedPriceCents: m.priceCents,
      selected: !!own?.active,
      myPriceCents: own?.priceCents ?? null,
    };
  });
}

export const selectionSchema = z.object({ masterProductIds: z.array(z.string().uuid()).max(2000) });

/**
 * Sets which catalogue products this shop sells. Newly ticked products
 * are added at the recommended price; unticked ones are hidden (not
 * deleted — past orders still reference them).
 */
export async function setCatalogueSelection(user: AuthenticatedUser, input: z.input<typeof selectionSchema>) {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const wanted = new Set(parsed.data.masterProductIds);

  await db.$transaction(async (tx) => {
    const masters = await tx.masterProduct.findMany({ where: { id: { in: [...wanted] }, active: true } });
    if (masters.length !== wanted.size) throw new ValidationError("Some of those products are no longer in the catalogue.");

    await tx.product.updateMany({
      where: { tenantId: user.tenantId, masterProductId: { notIn: [...wanted] }, NOT: { masterProductId: null } },
      data: { active: false },
    });
    for (const m of masters) {
      const linked = await tx.product.findUnique({ where: { tenantId_masterProductId: { tenantId: user.tenantId, masterProductId: m.id } } });
      if (linked) {
        if (!linked.active) await tx.product.update({ where: { id: linked.id }, data: { active: true } });
        continue;
      }
      const copy = {
        name: m.name,
        description: m.description,
        imageUrl: m.imageUrl,
        priceCents: m.priceCents,
        weightGrams: m.weightGrams,
        lengthCm: m.lengthCm,
        widthCm: m.widthCm,
        heightCm: m.heightCm,
        shippingCategory: m.shippingCategory,
        active: true,
        masterProductId: m.id,
      };
      // A product the seller added by hand with the same SKU gets linked
      // rather than duplicated.
      const sameSku = await tx.product.findUnique({ where: { tenantId_sku: { tenantId: user.tenantId, sku: m.sku } } });
      if (sameSku) await tx.product.update({ where: { id: sameSku.id }, data: copy });
      else await tx.product.create({ data: { tenantId: user.tenantId, sku: m.sku, ...copy } });
    }
  });
  return listCatalogueForShop(user);
}

export async function countActiveCatalogue() {
  return db.masterProduct.count({ where: { active: true } });
}
