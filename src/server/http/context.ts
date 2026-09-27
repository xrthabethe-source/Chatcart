import { cookies } from "next/headers";
import { db } from "../db.ts";
import { getSessionUser, isPlatformAdmin, SESSION_COOKIE_NAME, type AuthenticatedUser } from "../services/auth.ts";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../services/errors.ts";

export const CUSTOMER_COOKIE_NAME = "cc_customer";

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  return getSessionUser(store.get(SESSION_COOKIE_NAME)?.value);
}

export async function requireCurrentUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

export async function requirePlatformAdmin(): Promise<AuthenticatedUser> {
  const user = await requireCurrentUser();
  if (!isPlatformAdmin(user)) throw new ForbiddenError("Platform administrators only.");
  return user;
}

/** Public storefront: resolve a shop by its slug. */
export async function resolveShop(slug: string) {
  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new NotFoundError("Shop");
  return tenant;
}

export function secureCookies(): boolean {
  return process.env.APP_ENV !== "development";
}

export function sessionCookie(token: string) {
  return { name: SESSION_COOKIE_NAME, value: token, httpOnly: true, sameSite: "lax" as const, secure: secureCookies(), path: "/", maxAge: 30 * 24 * 3600 };
}
