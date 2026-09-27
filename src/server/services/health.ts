import { db } from "../db.ts";

/** Liveness + database reachability, for the hosting platform's health check. */
export async function checkHealth(): Promise<{ ok: boolean; database: "up" | "down" }> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, database: "up" };
  } catch {
    return { ok: false, database: "down" };
  }
}
