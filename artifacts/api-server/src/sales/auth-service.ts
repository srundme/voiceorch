import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, isNotNull, ne, sql } from "drizzle-orm";
import { salesInvitesTable, salesSessionsTable, salesUsersTable, type SalesUser } from "@workspace/db/schema";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { SalesError, writeAudit, notFound, type SalesActor, type SalesDb } from "./db.js";
import type { SalesRole } from "./stages.js";

export const SESSION_COOKIE = "ss_sales";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_FAILED_LOGINS = 8;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 10;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const GENERIC_LOGIN_ERROR = "Invalid email or password";

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function inviteUrlPath(token: string): string {
  return `/sales/invite/${token}`;
}

export function publicUser(u: SalesUser) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as SalesRole,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    deactivatedAt: u.deactivatedAt,
    createdAt: u.createdAt,
  };
}

function toActor(u: SalesUser): SalesActor {
  return { id: u.id, email: u.email, name: u.name, role: u.role as SalesRole };
}

let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

async function createInviteRow(db: SalesDb, email: string, role: SalesRole, invitedBy: number | null) {
  const normalized = normalizeLoginEmail(email);
  const now = new Date();
  await db
    .update(salesInvitesTable)
    .set({ revokedAt: now })
    .where(and(eq(salesInvitesTable.email, normalized), isNull(salesInvitesTable.acceptedAt), isNull(salesInvitesTable.revokedAt)));
  const { token, hash } = newToken();
  const [invite] = await db
    .insert(salesInvitesTable)
    .values({ email: normalized, role, tokenHash: hash, invitedBy, expiresAt: new Date(now.getTime() + INVITE_TTL_MS) })
    .returning();
  return { invite: invite!, token };
}

function inviteView(invite: typeof salesInvitesTable.$inferSelect) {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    invitedBy: invite.invitedBy,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  };
}

async function hasActiveAccount(db: SalesDb, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: salesUsersTable.id })
    .from(salesUsersTable)
    .where(and(eq(salesUsersTable.email, normalizeLoginEmail(email)), eq(salesUsersTable.status, "active"), isNotNull(salesUsersTable.passwordHash)));
  return Boolean(row);
}

export async function bootstrapFounderInvite(db: SalesDb, email: string) {
  return db.transaction(async (tx) => {
    const [founder] = await tx
      .select({ id: salesUsersTable.id })
      .from(salesUsersTable)
      .where(and(eq(salesUsersTable.role, "founder"), eq(salesUsersTable.status, "active"), isNotNull(salesUsersTable.passwordHash)));
    if (founder) throw new SalesError(409, "An active founder already exists; founders invite teammates from the sales app");
    const { invite, token } = await createInviteRow(tx, email, "founder", null);
    await writeAudit(tx, { actorUserId: null, entity: "sales_invite", entityId: invite.id, action: "bootstrap_founder_invite", after: inviteView(invite) });
    return { invite: inviteView(invite), token, inviteUrlPath: inviteUrlPath(token) };
  });
}

export async function findValidInvite(db: SalesDb, token: string) {
  const [invite] = await db
    .select()
    .from(salesInvitesTable)
    .where(and(
      eq(salesInvitesTable.tokenHash, hashToken(token)),
      isNull(salesInvitesTable.acceptedAt),
      isNull(salesInvitesTable.revokedAt),
      gt(salesInvitesTable.expiresAt, new Date()),
    ));
  return invite ?? null;
}

export async function createSession(db: SalesDb, userId: number, meta: SessionMeta): Promise<string> {
  const { token, hash } = newToken();
  await db.insert(salesSessionsTable).values({
    userId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 500) ?? null,
  });
  return token;
}

export async function acceptInvite(db: SalesDb, token: string, input: { name: string; password: string }, meta: SessionMeta) {
  const passwordHash = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(salesInvitesTable)
      .where(and(
        eq(salesInvitesTable.tokenHash, hashToken(token)),
        isNull(salesInvitesTable.acceptedAt),
        isNull(salesInvitesTable.revokedAt),
        gt(salesInvitesTable.expiresAt, new Date()),
      ))
      .for("update");
    if (!invite) throw new SalesError(404, "Invite is invalid or has expired");

    const [existing] = await tx.select().from(salesUsersTable).where(eq(salesUsersTable.email, invite.email));
    if (existing && existing.status === "active" && existing.passwordHash) {
      throw new SalesError(409, "An account already exists for this email");
    }
    const values = {
      name: input.name.trim(),
      role: invite.role,
      passwordHash,
      status: "active",
      failedLogins: 0,
      lockedUntil: null,
      deactivatedAt: null,
      lastLoginAt: new Date(),
    };
    const [saved] = existing
      ? await tx.update(salesUsersTable).set(values).where(eq(salesUsersTable.id, existing.id)).returning()
      : await tx.insert(salesUsersTable).values({ email: invite.email, ...values }).returning();
    await tx.update(salesInvitesTable).set({ acceptedAt: new Date() }).where(eq(salesInvitesTable.id, invite.id));
    await writeAudit(tx, {
      actorUserId: saved!.id,
      entity: "sales_user",
      entityId: saved!.id,
      action: "invite_accepted",
      after: { email: saved!.email, role: saved!.role, inviteId: invite.id },
    });
    return saved!;
  });
  const sessionToken = await createSession(db, user.id, meta);
  return { user: publicUser(user), token: sessionToken };
}

export async function login(db: SalesDb, email: string, password: string, meta: SessionMeta) {
  const normalized = normalizeLoginEmail(email);
  const [user] = await db.select().from(salesUsersTable).where(eq(salesUsersTable.email, normalized));
  const now = new Date();

  if (!user || !user.passwordHash || user.status !== "active") {
    await verifyPassword(password, await getDummyHash());
    throw new SalesError(401, GENERIC_LOGIN_ERROR);
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await verifyPassword(password, await getDummyHash());
    throw new SalesError(401, GENERIC_LOGIN_ERROR);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failures = user.failedLogins + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await db
      .update(salesUsersTable)
      .set({ failedLogins: lock ? 0 : failures, lockedUntil: lock ? new Date(now.getTime() + LOCKOUT_MS) : user.lockedUntil })
      .where(eq(salesUsersTable.id, user.id));
    if (lock) {
      await writeAudit(db, { actorUserId: null, entity: "sales_user", entityId: user.id, action: "locked_out", reason: `${MAX_FAILED_LOGINS} failed logins` });
    }
    throw new SalesError(401, GENERIC_LOGIN_ERROR);
  }

  const [updated] = await db
    .update(salesUsersTable)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now })
    .where(eq(salesUsersTable.id, user.id))
    .returning();
  const token = await createSession(db, user.id, meta);
  return { user: publicUser(updated!), token };
}

export interface ResolvedSession {
  actor: SalesActor;
  sessionId: number;
  refreshed: boolean;
}

export async function resolveSession(db: SalesDb, token: string): Promise<ResolvedSession | null> {
  const now = new Date();
  const [row] = await db
    .select({ session: salesSessionsTable, user: salesUsersTable })
    .from(salesSessionsTable)
    .innerJoin(salesUsersTable, eq(salesUsersTable.id, salesSessionsTable.userId))
    .where(and(eq(salesSessionsTable.tokenHash, hashToken(token)), isNull(salesSessionsTable.revokedAt), gt(salesSessionsTable.expiresAt, now)));
  if (!row || row.user.status !== "active") return null;

  let refreshed = false;
  if (now.getTime() - row.session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await db
      .update(salesSessionsTable)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(salesSessionsTable.id, row.session.id));
    refreshed = true;
  }
  return { actor: toActor(row.user), sessionId: row.session.id, refreshed };
}

export async function revokeSessionByToken(db: SalesDb, token: string): Promise<void> {
  await db
    .update(salesSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(salesSessionsTable.tokenHash, hashToken(token)), isNull(salesSessionsTable.revokedAt)));
}

export async function revokeUserSessions(db: SalesDb, userId: number): Promise<void> {
  await db
    .update(salesSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(salesSessionsTable.userId, userId), isNull(salesSessionsTable.revokedAt)));
}

export async function listUsers(db: SalesDb) {
  const users = await db.select().from(salesUsersTable).orderBy(salesUsersTable.id);
  const invites = await db
    .select()
    .from(salesInvitesTable)
    .where(and(isNull(salesInvitesTable.acceptedAt), isNull(salesInvitesTable.revokedAt), gt(salesInvitesTable.expiresAt, new Date())))
    .orderBy(desc(salesInvitesTable.createdAt));
  return { users: users.filter((u) => u.passwordHash).map(publicUser), invites: invites.map(inviteView) };
}

/** Active users only by default; `includeInactive` also returns deactivated users so old records keep their names. */
export async function listTeam(db: SalesDb, opts: { includeInactive?: boolean } = {}) {
  const users = await db
    .select({
      id: salesUsersTable.id,
      name: salesUsersTable.name,
      email: salesUsersTable.email,
      role: salesUsersTable.role,
      status: salesUsersTable.status,
    })
    .from(salesUsersTable)
    .where(
      opts.includeInactive
        ? isNotNull(salesUsersTable.passwordHash)
        : and(eq(salesUsersTable.status, "active"), isNotNull(salesUsersTable.passwordHash)),
    )
    .orderBy(salesUsersTable.name);
  return users;
}

export async function inviteUser(db: SalesDb, actor: SalesActor, input: { email: string; role: SalesRole }) {
  if (await hasActiveAccount(db, input.email)) throw new SalesError(409, "An active account already exists for this email");
  return db.transaction(async (tx) => {
    const { invite, token } = await createInviteRow(tx, input.email, input.role, actor.id);
    await writeAudit(tx, { actorUserId: actor.id, entity: "sales_invite", entityId: invite.id, action: "invite_created", after: inviteView(invite) });
    return { invite: inviteView(invite), token, inviteUrlPath: inviteUrlPath(token) };
  });
}

export async function revokeInvite(db: SalesDb, actor: SalesActor, inviteId: number) {
  const [invite] = await db
    .update(salesInvitesTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(salesInvitesTable.id, inviteId), isNull(salesInvitesTable.acceptedAt), isNull(salesInvitesTable.revokedAt)))
    .returning();
  if (!invite) throw notFound("Pending invite");
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_invite", entityId: invite.id, action: "invite_revoked", before: inviteView(invite) });
}

export async function updateUser(
  db: SalesDb,
  actor: SalesActor,
  userId: number,
  input: { role?: SalesRole; status?: "active" | "deactivated"; name?: string },
) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(salesUsersTable).where(eq(salesUsersTable.id, userId)).for("update");
    if (!user || !user.passwordHash) throw notFound("User");

    const losesFounder =
      user.role === "founder" && user.status === "active" &&
      ((input.role && input.role !== "founder") || input.status === "deactivated");
    if (losesFounder) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(salesUsersTable)
        .where(and(eq(salesUsersTable.role, "founder"), eq(salesUsersTable.status, "active"), isNotNull(salesUsersTable.passwordHash), ne(salesUsersTable.id, user.id)));
      if (!n) throw new SalesError(400, "At least one active founder is required");
    }

    const patch: Partial<typeof salesUsersTable.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.role !== undefined) patch.role = input.role;
    if (input.status === "deactivated" && user.status !== "deactivated") {
      patch.status = "deactivated";
      patch.deactivatedAt = new Date();
    } else if (input.status === "active" && user.status !== "active") {
      patch.status = "active";
      patch.deactivatedAt = null;
      patch.failedLogins = 0;
      patch.lockedUntil = null;
    }
    if (Object.keys(patch).length === 0) return publicUser(user);

    const [updated] = await tx.update(salesUsersTable).set(patch).where(eq(salesUsersTable.id, user.id)).returning();
    if (patch.status === "deactivated") await revokeUserSessions(tx, user.id);
    await writeAudit(tx, {
      actorUserId: actor.id,
      entity: "sales_user",
      entityId: user.id,
      action: patch.status === "deactivated" ? "deactivated" : patch.status === "active" ? "reactivated" : "updated",
      before: { role: user.role, status: user.status, name: user.name },
      after: { role: updated!.role, status: updated!.status, name: updated!.name },
    });
    return publicUser(updated!);
  });
}

export async function getActiveUser(db: SalesDb, userId: number): Promise<SalesUser | null> {
  const [user] = await db
    .select()
    .from(salesUsersTable)
    .where(and(eq(salesUsersTable.id, userId), eq(salesUsersTable.status, "active"), isNotNull(salesUsersTable.passwordHash)));
  return user ?? null;
}
