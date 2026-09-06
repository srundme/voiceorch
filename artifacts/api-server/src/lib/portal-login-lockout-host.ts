/** Pure portal login lockout helpers (no DB). */

export const PORTAL_LOGIN_MAX_ATTEMPTS = Math.max(
  1,
  parseInt(process.env["PORTAL_LOGIN_MAX_ATTEMPTS"] ?? "3", 10) || 3,
);

export function portalLoginLockedMessage(companyName: string): string {
  return `This account is locked after too many failed sign-in attempts. Contact ${companyName} to unlock it.`;
}

export function portalWrongPasswordMessage(attemptsRemaining: number): string {
  if (attemptsRemaining <= 1) {
    return "Wrong password. One more failed attempt will lock your account.";
  }
  return `Wrong password. ${attemptsRemaining} attempts remaining before your account is locked.`;
}

export function isPortalLoginLocked(user: {
  portalLoginLockedAt?: Date | string | null;
}): boolean {
  return !!user.portalLoginLockedAt;
}
