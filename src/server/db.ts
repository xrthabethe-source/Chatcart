import { PrismaClient, Prisma } from "@prisma/client";

// One client for the app. Tenant isolation is enforced in the service
// layer: every tenant-owned query in src/server/services filters by the
// acting tenant's id, and tests in services/*.test.ts assert cross-tenant
// access fails.
declare global {
  var __chatcartDb: PrismaClient | undefined;
}

export const db: PrismaClient = globalThis.__chatcartDb ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalThis.__chatcartDb = db;

export type DbClient = PrismaClient | Prisma.TransactionClient;
export { Prisma };
