// Invite links for onboarding associates: a platform admin creates a
// link (/join/<token>) and sends it on WhatsApp; the associate opens it
// on their phone and has a shop in a few minutes.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../db.ts";
import { normalisePhone } from "./customers.ts";
import { createSession, createShopInTx, hashPassword, sha256, type AuthenticatedUser } from "./auth.ts";
import { ConflictError, NotFoundError, ValidationError, zodMessage } from "./errors.ts";

export const createInviteSchema = z.object({
  label: z.string().trim().max(80).nullable().optional(),
  maxUses: z.number().int().min(1).max(500).default(1),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function createInvite(admin: AuthenticatedUser, input: z.input<typeof createInviteSchema>) {
  const parsed = createInviteSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const token = randomBytes(18).toString("base64url");
  const invite = await db.invite.create({
    data: {
      tokenHash: sha256(token),
      label: parsed.data.label ?? null,
      createdById: admin.tenantId,
      maxUses: parsed.data.maxUses,
      expiresAt: new Date(Date.now() + parsed.data.expiresInDays * 86_400_000),
    },
  });
  const url = `${appBaseUrl()}/join/${token}`;
  return { ...invite, url, whatsappText: inviteMessage(parsed.data.label ?? null, url) };
}

function inviteMessage(label: string | null, url: string): string {
  return `Hi${label ? ` ${label}` : ""}! Here's your link to open your online shop on Chatcart. It takes about 5 minutes:\n${url}`;
}

export async function listInvites(admin: AuthenticatedUser) {
  return db.invite.findMany({ where: { createdById: admin.tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
}

async function findUsableInvite(token: string, now = new Date()) {
  const invite = await db.invite.findUnique({ where: { tokenHash: sha256(String(token ?? "")) } });
  if (!invite || invite.expiresAt < now || invite.uses >= invite.maxUses) return null;
  return invite;
}

/** For the /join page: is this link still good, and who is it for? */
export async function checkInvite(token: string) {
  const invite = await findUsableInvite(token);
  if (!invite) throw new NotFoundError("Invite (it may have expired or already been used)");
  return { label: invite.label };
}

export const joinSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  shopName: z.string().trim().min(2).max(80).optional(),
  whatsappNumber: z.string().trim().min(9, "Enter your WhatsApp number.").max(20),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  associateId: z.string().trim().max(40).nullable().optional(),
});

export async function joinWithInvite(token: string, input: z.input<typeof joinSchema>) {
  const parsed = joinSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodMessage(parsed.error));
  const data = parsed.data;
  const whatsappNumber = normalisePhone(data.whatsappNumber);
  if (await db.user.findUnique({ where: { email: data.email } })) {
    throw new ConflictError("An account with this email already exists — log in instead.");
  }
  const passwordHash = await hashPassword(data.password);
  const firstName = data.name.split(" ")[0]!;

  const { user } = await db.$transaction(async (tx) => {
    // Claim a use atomically so a single-use link can't open two shops.
    const invite = await tx.invite.findUnique({ where: { tokenHash: sha256(String(token ?? "")) } });
    const claimed = invite
      ? await tx.invite.updateMany({
          where: { id: invite.id, uses: { lt: invite.maxUses }, expiresAt: { gt: new Date() } },
          data: { uses: { increment: 1 } },
        })
      : { count: 0 };
    if (!invite || claimed.count === 0) throw new NotFoundError("Invite (it may have expired or already been used)");

    return createShopInTx(tx, {
      shopName: data.shopName || `${firstName}'s Shop`,
      name: data.name,
      email: data.email,
      passwordHash,
      whatsappNumber,
      associateId: data.associateId || null,
      invitedById: invite.createdById,
    });
  });
  return { sessionToken: await createSession(user.id) };
}
