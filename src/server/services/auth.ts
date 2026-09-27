import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { db } from "../db.ts";
import { ConflictError, UnauthenticatedError, ValidationError, zodMessage } from "./errors.ts";
import { ensureTenantDeliveryProviders } from "./delivery-catalogue.ts";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE_NAME = "cc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  tenantName: string;
  tenantSlug: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "shop";
}

export const registerSchema = z.object({
  shopName: z.string().trim().min(2).max(80),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Password must be at least 10 characters.").max(200),
});

export async function registerSeller(input: z.input<typeof registerSchema>) {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const { shopName, name, email, password } = parsed.data;

  if (await db.user.findUnique({ where: { email } })) throw new ConflictError("An account with this email already exists.");
  const passwordHash = await hashPassword(password);
  const base = slugify(shopName);

  const tenant = await db.$transaction(async (tx) => {
    let slug = base;
    for (let i = 2; await tx.tenant.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    const created = await tx.tenant.create({ data: { name: shopName, slug, sellerDisplayName: name.split(" ")[0] } });
    await tx.user.create({ data: { tenantId: created.id, email, name, passwordHash } });
    await ensureTenantDeliveryProviders(tx, created.id);
    return created;
  });

  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { tenant, sessionToken: await createSession(user.id) };
}

export async function login(emailInput: string, password: string) {
  const email = String(emailInput ?? "").trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  // Same error for unknown email and wrong password: no account enumeration.
  if (!user || !(await verifyPassword(String(password ?? ""), user.passwordHash))) {
    throw new UnauthenticatedError("Invalid email or password.");
  }
  return { sessionToken: await createSession(user.id) };
}

async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  return token;
}

export async function logout(token: string | undefined) {
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function getSessionUser(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { tenant: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const { user } = session;
  return { id: user.id, tenantId: user.tenantId, email: user.email, name: user.name, tenantName: user.tenant.name, tenantSlug: user.tenant.slug };
}

/** Platform administrators (manage the courier catalogue and PAXI directory). */
export function isPlatformAdmin(user: AuthenticatedUser): boolean {
  const admins = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(user.email.toLowerCase());
}
