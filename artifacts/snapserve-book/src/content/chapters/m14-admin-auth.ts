import type { Chapter } from "../types";

export const adminAuth: Chapter = {
  slug: "admin-auth-impersonation",
  moduleId: "m14",
  number: "15.2",
  title: "Admin Auth & Impersonation",
  summary:
    "The separate admin authentication layer, the x-admin-token header, and how impersonation exchange codes let support staff log in as any user without knowing their password.",
  estMinutes: 10,
  fileRef: "artifacts/api-server/src/middlewares/requireAdmin.ts",
  prerequisites: ["google-oauth-sessions", "middleware-and-auth"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Two separate auth systems",
      paragraphs: [
        "SnapServe runs two completely separate authentication systems on the same server. User auth uses Google OAuth + session JWTs (Bearer tokens, covered in the previous chapter). Admin auth uses a static bearer token: the `ADMIN_TOKEN` environment variable.",
        "Admin routes live under `/api/admin/*` and are guarded by `requireAdmin` middleware. This middleware checks a single header: `x-admin-token`. If the header matches `process.env.ADMIN_TOKEN`, the request proceeds. If not, it returns 403.",
        "The admin panel is a separate frontend artifact (`artifacts/admin`) served at `/admin`. It is not visible to end-users — it is SnapServe's internal ops dashboard for managing user accounts, platform keys, billing, and agent configuration across all tenants.",
      ],
    },
    {
      kind: "concept",
      title: "Why a static token and not a Google OAuth flow?",
      body: [
        "Admin access is intentionally narrow and simple. A static token means: no database dependency for authentication (useful when debugging DB issues), no OAuth flow that could be intercepted, and no session expiry to manage during incident response.",
        "The tradeoff: the token can't be scoped per-admin, can't be revoked per-user, and provides no audit trail of which human performed which action (everyone with the token looks the same in logs). For a small ops team this is acceptable; for a large enterprise it would not be.",
        "The token should be a long, randomly-generated string (at least 32 characters) stored as a Railway environment variable. It should be rotated when any team member leaves.",
      ],
    },
    {
      kind: "code",
      filename: "middlewares/requireAdmin.ts",
      language: "typescript",
      intro: "The entire admin authentication middleware — intentionally minimal.",
      code: `export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token  = req.headers["x-admin-token"];
  const secret = process.env["ADMIN_TOKEN"];

  if (!secret) {
    logger.error("ADMIN_TOKEN not configured");
    res.status(500).json({ error: "Admin not configured" });
    return;
  }

  if (!token || token !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
}`,
      lines: [
        {
          lines: "8-12",
          label: "missing ADMIN_TOKEN = 500",
          explanation:
            "If `ADMIN_TOKEN` is not set in the environment, the middleware returns 500 instead of 403. This is intentional — a missing token means the deployment is misconfigured, not that the request is unauthorized. Distinguishes 'nobody can log in' from 'you specifically can't log in'.",
        },
        {
          lines: "14-17",
          label: "plain string comparison",
          explanation:
            "The comparison is a plain `!==`. For a static admin token this is acceptable — timing attacks against a long, random token are not a practical threat (the token would need to be brute-forced character by character over thousands of requests, which rate-limiting prevents). `timingSafeEqual` would be overkill here.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Impersonation: logging in as any user",
      paragraphs: [
        "Support staff sometimes need to reproduce a user's issue. SnapServe provides impersonation: an admin can POST to `/api/admin/impersonate/:clerkId` and receive a short-lived exchange code. They then visit the dashboard with `?impersonate=<code>` and the frontend exchanges that code for a full user session JWT.",
        "The exchange code is a single-use, short-lived (5-minute TTL) hex string stored in the `users` table (`exchange_code` and `exchange_code_expires_at` columns, added in migration `0012_impersonation_exchange_code`). Once used, the `exchange_code` is cleared from the DB so it cannot be replayed.",
        "The impersonation session JWT is identical to a regular user session JWT — the same format, the same `SESSION_SECRET` signature. Once impersonation is in effect, the server cannot tell it apart from a real login. All actions taken during impersonation are attributed to the user, not the admin. This is an intentional trade-off for simplicity.",
      ],
    },
    {
      kind: "code",
      filename: "routes/admin-user-mgmt.ts",
      language: "typescript",
      intro: "Creating an impersonation exchange code — the admin-side endpoint.",
      code: `router.post(
  "/admin/impersonate/:clerkId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const { clerkId } = req.params;

    const code    = randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await db.update(usersTable)
      .set({
        exchangeCode:          code,
        exchangeCodeExpiresAt: expires,
      })
      .where(eq(usersTable.clerkId, clerkId));

    res.json({ code, expiresAt: expires.toISOString() });
  }
);`,
      lines: [
        {
          lines: "7-8",
          label: "48-char random code, 5-minute TTL",
          explanation:
            "`randomBytes(24).toString('hex')` produces 48 hex characters — unguessable by brute force. The 5-minute TTL means even if a code is leaked (e.g. in a browser history), it expires before it can be reused.",
        },
        {
          lines: "10-15",
          label: "stored in users table",
          explanation:
            "The code is stored directly on the user's row. There's only ever one pending impersonation code per user — a second POST overwrites the first. This is intentional: support staff who request two codes shouldn't hold both simultaneously.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Migration 0012 must be applied before using impersonation",
      body: [
        "The `exchange_code` and `exchange_code_expires_at` columns were added in migration `0012_impersonation_exchange_code`. If this migration has not been applied to the production database (e.g. on a fresh deployment or after a production wipe), the INSERT in `POST /api/admin/impersonate` will fail with an 'unknown column' error. Run `pnpm --filter @workspace/db run push` (dev) or apply the migration SQL manually before using 'Login As User' in the admin panel.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "An admin uses 'Login As User' to impersonate user X and performs an action. In the audit logs, whose ID appears?",
          choices: [
            "The admin's ID — `requireAdmin` tags all impersonated actions",
            "A combined ID like 'admin:user_X' to show both parties",
            "User X's ID — the session JWT is identical to a real user session",
            "No ID — impersonated actions are logged separately without a user ID",
          ],
          correctIndex: 2,
          explanation:
            "The impersonation session JWT is identical to a real login JWT — same format, same `sub`, same `SESSION_SECRET`. The server cannot distinguish it from user X's own session. All actions appear as user X's. This is intentional simplicity; a full audit system would tag the JWT with an `impersonatedBy` claim.",
        },
        {
          prompt: "An admin generates an impersonation code but the support call ends before the engineer uses it. What happens after 5 minutes?",
          choices: [
            "The code expires but remains in the DB until the next impersonation request overwrites it",
            "The code is automatically deleted from the DB by a cleanup job",
            "The dashboard blocks access once the code is used OR expired",
            "The code becomes permanently valid until explicitly revoked",
          ],
          correctIndex: 0,
          explanation:
            "`exchange_code_expires_at` is checked on the redemption endpoint (`GET /api/auth/exchange`) — if `now() > expires`, the redemption is rejected. The row itself isn't deleted automatically; it stays in the DB with the expired code. The next `POST /admin/impersonate` for that user overwrites it.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Admin auth = single `x-admin-token` header checked by `requireAdmin` middleware",
        "Missing `ADMIN_TOKEN` env var → 500 (misconfiguration), not 403 (unauthorized)",
        "Impersonation: admin creates 5-minute exchange code → engineer visits dashboard with `?impersonate=code` → full user session issued",
        "Exchange code is single-use, stored on the user row, overwritten by next impersonation request",
        "Migration 0012 must be applied before impersonation works — missing columns = INSERT failure",
      ],
    },
  ],
};
