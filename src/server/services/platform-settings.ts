// Platform-wide defaults, set by a platform admin.
import { z } from "zod";
import { db } from "../db.ts";
import { paxiConfigSchema } from "../delivery/providers/paxi.ts";
import { ValidationError, zodMessage } from "./errors.ts";
import type { Prisma } from "@prisma/client";

const PAXI_TARIFF_KEY = "paxi_default_tariff";

const tariffSchema = paxiConfigSchema.shape.tariff.removeDefault().min(1, "Add at least one PAXI price.");
export type PaxiTariff = z.infer<typeof tariffSchema>;

/** The PAXI prices every new associate starts with (null until set). */
export async function getDefaultPaxiTariff(): Promise<PaxiTariff | null> {
  const row = await db.platformSetting.findUnique({ where: { key: PAXI_TARIFF_KEY } });
  if (!row) return null;
  const parsed = tariffSchema.safeParse(row.value);
  return parsed.success ? parsed.data : null;
}

export async function setDefaultPaxiTariff(input: unknown): Promise<PaxiTariff> {
  const parsed = tariffSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  for (const t of parsed.data) {
    if (t.etaMinDays > t.etaMaxDays) throw new ValidationError(`"${t.name}": minimum days can't be more than maximum days.`);
  }
  await db.platformSetting.upsert({
    where: { key: PAXI_TARIFF_KEY },
    update: { value: parsed.data as Prisma.InputJsonValue },
    create: { key: PAXI_TARIFF_KEY, value: parsed.data as Prisma.InputJsonValue },
  });
  return parsed.data;
}
