import type { Chapter } from "../types";

export const middlewareAndAuth: Chapter = {
  slug: "middleware-and-auth",
  moduleId: "m3",
  number: "4.4",
  title: "Middleware & Authentication",
  summary:
    "How a request proves who it is — session JWTs, the `attachSession` middleware, and the admin-token boundary.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/middlewares/session.ts",
  prerequisites: ["express-app"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Every protected endpoint needs to answer one question before it does anything: **who is asking?** When the dashboard requests `GET /api/agents`, the server must know which user's agents to return — and must be certain the requester really is that user, not someone who guessed an id. That proof of identity is **authentication**, and in SnapServe it rides on a small signed token called a **session JWT**.",
        "`attachSession` is the middleware that reads that token, verifies it, and stamps the user's identity onto the request. It runs **globally**, before rate limiting and before any route — so by the time a handler runs, `req.clerkUserId` already holds the verified user id (or doesn't, if the request was anonymous). This chapter walks that middleware, the JWT it trusts, and the **completely separate** admin-token boundary that guards the back office.",
      ],
    },
    {
      kind: "concept",
      title: "What is a JWT, and why HS256?",
      body: [
        "A **JWT** (JSON Web Token) is three base64url chunks joined by dots: `header.payload.signature`. The header says how it's signed; the payload is plain JSON (the user's id, email, expiry); the signature is an HMAC of `header.payload` computed with a secret only the server knows.",
        "Per SnapServe's `replit.md`: the session token is an **HS256** JWT signed with `SESSION_SECRET`, with a 30-day TTL, carrying the Google account `sub` plus email and name. HS256 means **symmetric** signing — the same secret both signs and verifies. Anyone can *read* the payload (it's just base64), but only someone with the secret can *forge a valid signature*. So the server trusts the payload **only after** the signature checks out.",
        "This makes the token **stateless**: the server doesn't store sessions in a database. It hands you a signed token at login; on every later request it re-verifies the signature and trusts the claims inside. No session table lookup needed — which is exactly why it scales so cheaply.",
      ],
    },
    {
      kind: "analogy",
      title: "A tamper-proof wristband",
      body: [
        "Think of a festival wristband with a hologram. At the gate (login) you prove who you are once and get a wristband stamped with your name and an expiry date. After that, every stage you walk up to just glances at the wristband — no need to re-check your ID, because the hologram (the signature) proves it's genuine and unaltered.",
        "Tear or fake the wristband and the hologram won't match — staff turn you away. The JWT signature is that hologram: cheap to glance at, impossible to forge without the secret, and it carries just enough info (your name, your expiry) to wave you through without a database trip.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/lib/session.ts",
      language: "typescript",
      intro:
        "First, the token's shape. `SessionPayload` is exactly what gets signed into the JWT — note `imp`, which only appears on impersonation tokens.",
      code: `export interface SessionPayload {
  /** Google account subject id — stored in users.clerk_id. */
  sub: string;
  email: string | null;
  name: string | null;
  iat: number;
  exp: number;
  /**
   * Present only on impersonation tokens. Carries the opaque
   * admin_impersonation_sessions.session_token so that attachSession can
   * check server-side revocation on every request — impersonation JWTs are
   * NOT purely stateless.
   */
  imp?: string;
}`,
      lines: [
        {
          lines: "2-3",
          label: "sub",
          explanation:
            "The Google account subject id. Critically, it's stored in the `users.clerk_id` column — that column was **repurposed** during the Clerk→Google migration to hold the Google `sub` rather than being renamed. So `req.clerkUserId` is really the Google sub.",
        },
        {
          lines: "4-5",
          label: "email & name",
          explanation:
            "Carried in the token so the server can provision or heal a user record without calling Google on every request. They can be null until identity is filled in.",
        },
        {
          lines: "6-7",
          label: "iat & exp",
          explanation:
            "Issued-at and expiry timestamps (Unix seconds). Verification rejects any token whose `exp` is in the past — that's the 30-day TTL enforced.",
        },
        {
          lines: "8-15",
          label: "imp (impersonation)",
          explanation:
            "Optional. When an admin is impersonating a user, the token carries the opaque impersonation session token. This makes impersonation JWTs **NOT** purely stateless: they require a live revocation check, which is what makes 'end impersonation' actually revoke retained tokens.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/lib/session.ts",
      language: "typescript",
      intro:
        "Verification is where trust is decided. Read it carefully — the order of checks is a security feature, and `timingSafeEqual` matters.",
      code: `export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, providedSig] = parts as [string, string, string];
    const data = \`\${header}.\${body}\`;
    const expected = Buffer.from(sign(data), "utf8");
    const provided = Buffer.from(providedSig, "utf8");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload || typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}`,
      lines: [
        {
          lines: "3-5",
          label: "split into 3 parts",
          explanation:
            "A real JWT is exactly `header.payload.signature`. Anything else is rejected immediately. We then name the three pieces.",
        },
        {
          lines: "6-7",
          label: "recompute the signature",
          explanation:
            "`sign(data)` re-derives the HMAC-SHA256 of `header.payload` using `SESSION_SECRET`. If the token is genuine, this `expected` signature will match the one the client presented.",
        },
        {
          lines: "9-11",
          label: "timingSafeEqual",
          explanation:
            "Compare expected vs provided in **constant time**. A naive `===` returns faster on an early-mismatch, leaking timing info an attacker could use to guess the signature byte-by-byte. `timingSafeEqual` always takes the same time. Mismatch → return null (untrusted).",
        },
        {
          lines: "12-14",
          label: "parse & validate claims",
          explanation:
            "Only AFTER the signature passes do we decode the payload and sanity-check it: a non-empty string `sub`, and an `exp` that hasn't passed. An expired or malformed token returns null.",
        },
        {
          lines: "16-17",
          label: "catch → null",
          explanation:
            "Any parse error (bad base64, broken JSON) is swallowed and becomes `null`. The function's contract is simple: a valid `SessionPayload` or nothing — never a throw, never a half-trusted token.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why verify the signature BEFORE reading the payload?",
      body: [
        "The payload is just base64 — anyone can decode it and even change it. If you trusted the JSON first and verified later (or never), an attacker could edit `sub` to someone else's id and impersonate them.",
        "Verifying the HMAC first means: *don't believe a single claim until the hologram checks out.* Only a holder of `SESSION_SECRET` can produce a signature that matches the (possibly tampered) header+payload, so a valid signature is proof the payload is exactly what the server issued.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/lib/session.ts",
      language: "typescript",
      intro:
        "How does the token reach the server? Two ways — and the second exists for a real browser limitation.",
      code: `/** Pull a bearer token from the Authorization header, or \`?token=\` query (EventSource). */
export function extractRequestToken(req: Request): string | null {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const t = header.slice(7).trim();
    if (t) return t;
  }
  const q = req.query?.["token"];
  if (typeof q === "string" && q) return q;
  return null;
}`,
      lines: [
        {
          lines: "3-7",
          label: "Authorization: Bearer",
          explanation:
            "The normal path. The dashboard sends `Authorization: Bearer <jwt>`. We slice off the 7-character `Bearer ` prefix and return the token. This is the preferred, header-based channel.",
        },
        {
          lines: "8-9",
          label: "?token= fallback",
          explanation:
            "`EventSource` (Server-Sent Events) and the webcall WebSocket **cannot** set custom headers, so they pass the token as a `?token=` query param instead. Same JWT, different envelope. (Recall index.ts redacts this from logs.)",
        },
        {
          lines: "10",
          label: "return null",
          explanation:
            "No token in either place → null. The request is simply anonymous; `attachSession` won't reject it, it just won't attach an identity.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/middlewares/session.ts",
      language: "typescript",
      intro:
        "Now the middleware itself — small but pivotal. It annotates the request with identity and never rejects.",
      code: `export async function attachSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractRequestToken(req);
  const payload = token ? verifySessionToken(token) : null;
  if (payload) {
    if (payload.imp) {
      const active = await isImpersonationSessionActive(payload.imp);
      if (!active) {
        next();
        return;
      }
    }
    (req as unknown as { sessionPayload: SessionPayload }).sessionPayload = payload;
    (req as unknown as { clerkUserId: string }).clerkUserId = payload.sub;
  }
  next();
}`,
      lines: [
        {
          lines: "2-3",
          label: "extract + verify",
          explanation:
            "Grab the token (header or query) and verify it. If there's no token or it fails verification, `payload` is null and we skip straight to `next()` — an anonymous request, perfectly allowed at this stage.",
        },
        {
          lines: "5-11",
          label: "impersonation revocation check",
          explanation:
            "If the token carries an `imp` claim, do a fast cached DB check that the impersonation session is still active. If an admin has ended it, the retained token is denied within the cache TTL (≤ 5 s) — we call `next()` WITHOUT attaching identity, so the request becomes anonymous.",
        },
        {
          lines: "12-13",
          label: "attach identity",
          explanation:
            "The payoff: stamp `req.sessionPayload` (full payload, used by `provisionUser`) and `req.clerkUserId` (the Google sub) onto the request. Every downstream handler and `requireAuth` reads these.",
        },
        {
          lines: "14",
          label: "next() — never rejects",
          explanation:
            "`attachSession` ALWAYS calls `next()`. It only *annotates*; it never sends a 401. Enforcement is deliberately deferred to `requireAuth` on the individual routes that need it. This separation keeps public routes public and protected routes protected with one shared identity step.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/middlewares/requireAuth.ts",
      language: "typescript",
      intro:
        "Enforcement lives here. `requireAuth` is the gate route handlers opt into — it simply demands that `attachSession` already attached an identity.",
      code: `export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as unknown as { clerkUserId?: string }).clerkUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}`,
      lines: [
        {
          lines: "2",
          label: "read clerkUserId",
          explanation:
            "It trusts that `attachSession` (app-level) already ran and either set `clerkUserId` or didn't. No re-verification — that work was done once, globally.",
        },
        {
          lines: "3-6",
          label: "401 if missing",
          explanation:
            "No identity → `401 Unauthorized` and stop. This is the **enforcement** step `attachSession` deliberately skipped. A route guards itself by listing `requireAuth` in its middleware chain.",
        },
        {
          lines: "7",
          label: "next()",
          explanation:
            "Identity present → proceed to the handler, which can safely read `req.clerkUserId` knowing it's a verified user.",
        },
      ],
    },
    {
      kind: "concept",
      title: "The admin boundary is a different door",
      body: [
        "User auth (the session JWT) and **admin** auth are completely separate systems. As `replit.md` puts it: 'Admin auth is separate (`x-admin-token`) and untouched.'",
        "Admin endpoints don't trust a user's JWT at all. Instead they require a static secret in the `x-admin-token` header, checked against the `ADMIN_TOKEN` (or `SUPER_ADMIN_TOKEN`) environment variable. There's no per-user identity here — it's a shared key that proves 'you are operating the back office.' Keeping the two boundaries apart means a regular user token can never reach an admin route, and vice-versa.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/middlewares/requireAdmin.ts",
      language: "typescript",
      intro:
        "The admin gate — note it ignores the session entirely and checks a header against an env secret.",
      code: `export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"] as string | undefined;
  const adminToken = process.env["ADMIN_TOKEN"];
  const superAdminToken = process.env["SUPER_ADMIN_TOKEN"];

  if (!adminToken) {
    res.status(503).json({ error: "Admin access not configured" });
    return;
  }
  const validTokens = new Set([adminToken]);
  if (superAdminToken) validTokens.add(superAdminToken);

  if (!token || !validTokens.has(token)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}`,
      lines: [
        {
          lines: "2-4",
          label: "read the header + env secrets",
          explanation:
            "The admin token arrives in the `x-admin-token` header (NOT `Authorization`). It's compared against `ADMIN_TOKEN` and optionally `SUPER_ADMIN_TOKEN` from the environment — there is no user, no JWT, no `sub`.",
        },
        {
          lines: "6-9",
          label: "503 if not configured",
          explanation:
            "If no `ADMIN_TOKEN` is set at all, admin access is shut off with a `503` rather than silently allowing anyone — fail closed, never open.",
        },
        {
          lines: "10-11",
          label: "accept admin or super-admin",
          explanation:
            "Both tokens are valid keys; super-admin holders can reach every admin endpoint too. They're collected into a `Set` for a clean membership check.",
        },
        {
          lines: "13-16",
          label: "403 on mismatch",
          explanation:
            "Wrong or missing token → `403 Forbidden`. Note the codes tell different stories: `503` = the door isn't installed; `403` = the door is installed and you don't have the key.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Impersonation tokens aren't purely stateless",
      body: [
        "A normal session JWT is fully stateless — verify the signature and you're done, no DB. But an **impersonation** token carries an `imp` claim and requires a live check (`isImpersonationSessionActive`) on every request.",
        "That's the whole point: it makes impersonation **server-side revocable**. When an admin clicks 'end session', any retained impersonation token stops working within the cache TTL (≤ 5 s) — even though, signature-wise, the JWT is still 'valid' and unexpired.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Identity flows from login, through verification, onto the request. Click any box to jump to its chapter.",
      nodes: [
        { id: "app", label: "app.ts", sublabel: "app.use(attachSession)", chapterSlug: "express-app" },
        { id: "attach", label: "attachSession", sublabel: "THIS FILE — annotates req", current: true },
        { id: "verify", label: "verifySessionToken", sublabel: "lib/session.ts — HMAC check" },
        { id: "require", label: "requireAuth", sublabel: "enforces 401 in routes", chapterSlug: "routes-anatomy" },
        { id: "admin", label: "requireAdmin", sublabel: "separate x-admin-token door" },
        { id: "routes", label: "route handlers", sublabel: "read req.clerkUserId", chapterSlug: "routes-anatomy" },
      ],
      edges: [
        { from: "app", to: "attach", label: "runs globally" },
        { from: "attach", to: "verify", label: "verify JWT" },
        { from: "attach", to: "routes", label: "sets req.clerkUserId" },
        { from: "require", to: "routes", label: "guards" },
        { from: "admin", to: "routes", label: "separate boundary" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt:
            "Why does `verifySessionToken` use `timingSafeEqual` instead of `===` to compare signatures?",
          choices: [
            "It's faster.",
            "Constant-time comparison prevents a timing side-channel attacker could use to guess the signature byte-by-byte.",
            "`===` doesn't work on Buffers.",
            "It allows partial matches.",
          ],
          correctIndex: 1,
          explanation:
            "A naive comparison can short-circuit on the first mismatched byte, leaking timing info. `timingSafeEqual` always takes the same time, closing that side channel.",
        },
        {
          prompt:
            "What does `attachSession` do when a request has no token or an invalid one?",
          choices: [
            "Responds with 401 immediately.",
            "Calls next() without attaching identity — the request proceeds anonymously, and enforcement is left to requireAuth.",
            "Crashes the server.",
            "Redirects to the login page.",
          ],
          correctIndex: 1,
          explanation:
            "`attachSession` never rejects — it only annotates. Anonymous requests continue; routes that need a user add `requireAuth`, which returns the 401.",
        },
        {
          prompt:
            "How is admin authentication different from user authentication in SnapServe?",
          choices: [
            "Admins use a longer JWT.",
            "Admin auth is a separate boundary using a static `x-admin-token` header checked against an env secret — no user JWT, no per-user identity.",
            "They are the same system.",
            "Admins authenticate with a password each request.",
          ],
          correctIndex: 1,
          explanation:
            "Per replit.md, admin auth is separate and untouched: `requireAdmin` checks `x-admin-token` against `ADMIN_TOKEN`/`SUPER_ADMIN_TOKEN`. A user session JWT can never satisfy it.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "The session token is a stateless HS256 JWT signed with `SESSION_SECRET`, carrying the Google `sub`, email, name, and a 30-day expiry.",
        "Verify the signature with `timingSafeEqual` BEFORE trusting any claim in the payload.",
        "`attachSession` runs globally and only annotates the request (`req.clerkUserId`, `req.sessionPayload`) — it never rejects.",
        "`requireAuth` is the enforcement gate routes opt into; it returns 401 when no identity is attached.",
        "Tokens arrive via `Authorization: Bearer` or `?token=` (for SSE/WebSockets that can't set headers).",
        "Admin auth is a completely separate boundary: `x-admin-token` vs an env secret, with no per-user identity.",
        "Impersonation tokens carry an `imp` claim and need a live revocation check, so they're not purely stateless.",
      ],
    },
  ],
};
