/**
 * Managed-client portal login lockout.
 *
 * On a partner white-label host, after N failed password attempts the client
 * account is locked. Admin + partner owner are notified; either can unlock.
 */
import { db, partnersTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { createAlert } from "../services/usage/alert-engine.js";
import { sendBrevoEmail } from "../services/brevo.js";
import { partnerPortalLoginUrl } from "./partner-portal-access.js";
import {
  PORTAL_LOGIN_MAX_ATTEMPTS,
  isPortalLoginLocked,
  portalLoginLockedMessage,
} from "./portal-login-lockout-host.js";

export {
  PORTAL_LOGIN_MAX_ATTEMPTS,
  isPortalLoginLocked,
  portalLoginLockedMessage,
} from "./portal-login-lockout-host.js";

export async function clearPortalLoginFailures(userId: number): Promise<void> {
  await db
    .update(usersTable)
    .set({
      portalLoginFailedAttempts: 0,
      portalLoginLockedAt: null,
      portalLoginLockedReason: null,
    })
    .where(eq(usersTable.id, userId));
}

export async function unlockPortalLogin(userId: number): Promise<void> {
  await clearPortalLoginFailures(userId);
}

type LockNotifyCtx = {
  clerkId: string;
  email: string | null;
  name: string | null;
  partnerId: number;
  companyName: string;
  attempts: number;
};

async function notifyPortalLoginLockout(ctx: LockNotifyCtx): Promise<void> {
  const who = ctx.email || ctx.name || ctx.clerkId;
  const title = `Managed client login locked — ${ctx.companyName}`;
  const message =
    `${who} failed password sign-in ${ctx.attempts} times on the ${ctx.companyName} portal and is locked until unlocked by admin or the partner owner.`;

  void createAlert({
    type: "portal_login_lockout",
    severity: "warning",
    title,
    message,
    payload: {
      clerkId: ctx.clerkId,
      email: ctx.email,
      partnerId: ctx.partnerId,
      companyName: ctx.companyName,
      attempts: ctx.attempts,
    },
    dedupeKey: `portal_login_lockout:${ctx.clerkId}:${Date.now()}`,
  });

  try {
    const [partner] = await db
      .select({
        userId: partnersTable.userId,
        companyName: partnersTable.companyName,
        slug: partnersTable.slug,
        customDomain: partnersTable.customDomain,
        customDomainStatus: partnersTable.customDomainStatus,
      })
      .from(partnersTable)
      .where(eq(partnersTable.id, ctx.partnerId))
      .limit(1);
    if (!partner) return;

    const [owner] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.clerkId, partner.userId))
      .limit(1);
    if (!owner?.email) return;

    const loginBase = partnerPortalLoginUrl(partner);
    const html = `
      <p>Hi ${owner.name || "there"},</p>
      <p>A managed client on <strong>${ctx.companyName}</strong> hit too many failed sign-ins and was locked.</p>
      <ul>
        <li><strong>Client:</strong> ${who}</li>
        <li><strong>Attempts:</strong> ${ctx.attempts}</li>
        <li><strong>Portal:</strong> ${loginBase}/sign-in</li>
      </ul>
      <p>Unlock them from Partner Hub → Clients, or ask SnapServe admin to unlock.</p>
    `;
    await sendBrevoEmail(
      owner.email,
      `[${ctx.companyName}] Client login locked: ${who}`,
      html,
      undefined,
      {
        emailType: "portal_login_lockout",
        toUserId: partner.userId,
        toName: owner.name,
      },
    );
  } catch (err) {
    logger.warn({ err, partnerId: ctx.partnerId }, "portal login lockout partner email failed");
  }
}

/**
 * Record a failed portal password attempt for a managed client.
 * Returns whether the account is now locked.
 */
export async function recordPortalLoginFailure(opts: {
  userId: number;
  clerkId: string;
  email: string | null;
  name: string | null;
  partnerId: number;
  companyName: string;
  priorAttempts: number;
}): Promise<{ locked: boolean; attempts: number }> {
  const attempts = opts.priorAttempts + 1;
  const shouldLock = attempts >= PORTAL_LOGIN_MAX_ATTEMPTS;
  const lockedAt = shouldLock ? new Date() : null;
  const reason = shouldLock
    ? `Locked after ${attempts} failed portal sign-in attempts`
    : null;

  await db
    .update(usersTable)
    .set({
      portalLoginFailedAttempts: attempts,
      portalLoginLockedAt: lockedAt,
      portalLoginLockedReason: reason,
    })
    .where(eq(usersTable.id, opts.userId));

  if (shouldLock) {
    logger.warn(
      { clerkId: opts.clerkId, partnerId: opts.partnerId, attempts },
      "Managed client portal login locked",
    );
    void notifyPortalLoginLockout({
      clerkId: opts.clerkId,
      email: opts.email,
      name: opts.name,
      partnerId: opts.partnerId,
      companyName: opts.companyName,
      attempts,
    });
  }

  return { locked: shouldLock, attempts };
}
