import type { Chapter } from "../types";

export const googleOauthSessions: Chapter = {
  slug: "google-oauth-sessions",
  moduleId: "m14",
  number: "15.1",
  title: "Google OAuth & Session JWTs",
  summary:
    "How SnapServe authenticates users without Clerk or Passport — a platform-owned Google OAuth app, a self-issued HS256 JWT, and a URL-fragment delivery pattern.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/routes/auth.ts",
  prerequisites: ["middleware-and-auth", "express-app"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "No Clerk, no Passport — just Google OAuth and a JWT",
      paragraphs: [
        "SnapServe's auth system looks simple from the outside — users click 'Sign in with Google' — but the implementation is entirely custom. There is no Clerk, no Auth0, no Passport.js. The platform owns a Google OAuth app and issues its own session tokens.",
        "This design emerged from a migration: the product originally used Clerk, which had per-user pricing that became expensive at scale. The migration preserved the `clerk_id` column name in the `users` table (now stores the Google `sub` instead of a Clerk user ID) to avoid renaming ~20 files that reference `req.clerkUserId`.",
        "The auth code lives in two files: `routes/auth.ts` (the OAuth redirect and callback routes) and `lib/session.ts` (JWT creation and validation). Understanding them means understanding every protected endpoint in the platform.",
      ],
    },
    {
      kind: "concept",
      title: "The OAuth flow in four steps",
      body: [
        "**Step 1 — Redirect**: `GET /api/auth/google/connect` redirects the browser to Google's authorization URL with `client_id`, `redirect_uri`, `scope` (email + profile), and a `state` parameter (a random nonce stored server-side to prevent CSRF).",
        "**Step 2 — Callback**: Google redirects to `GET /api/auth/google/callback?code=…&state=…`. The server validates the `state` parameter matches what was stored, then exchanges the `code` for access + ID tokens via `POST https://oauth2.googleapis.com/token`.",
        "**Step 3 — Provision**: The ID token's `sub` (Google's user ID) is used to look up or create a user in the `users` table. First-time users get `name`, `email`, a $5 welcome credit, and default API keys seeded via `userProvisioning.ts`.",
        "**Step 4 — Token delivery**: A platform session JWT (HS256, signed with `SESSION_SECRET`) is minted with the user's `sub`, email, and name. It is NOT set as a cookie — it is delivered via the callback redirect URL fragment: `https://app.snapserve.ai/#session=<jwt>`. The frontend reads the fragment, stores the JWT in `localStorage['voiceorch:session']`, and strips the fragment from the URL.",
      ],
    },
    {
      kind: "code",
      filename: "routes/auth.ts",
      language: "typescript",
      intro: "The callback route — state validation, token exchange, user provisioning, and JWT delivery.",
      code: `router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const { code, state } = req.query as Record<string, string>;

  // Validate CSRF state
  const storedState = await redis.get(\`oauth:state:\${state}\`);
  if (!storedState) {
    res.redirect(\`/#error=invalid_state\`);
    return;
  }
  await redis.del(\`oauth:state:\${state}\`);

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id:     process.env["GOOGLE_CLIENT_ID"]!,
      client_secret: process.env["GOOGLE_CLIENT_SECRET"]!,
      redirect_uri:  \`\${getAppDomain()}/api/auth/google/callback\`,
      grant_type:    "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  const idToken = decodeJwt(tokens.id_token);      // decode, don't verify (Google already verified)

  const googleSub = idToken.sub as string;
  const email     = idToken.email as string;
  const name      = idToken.name  as string;

  // Provision or update user
  const user = await provisionUser({ googleSub, email, name });

  // Mint platform session JWT (30-day TTL)
  const sessionToken = signJwt(
    { sub: googleSub, email, name },
    process.env["SESSION_SECRET"]!,
    { expiresIn: "30d" },
  );

  // Deliver via URL fragment (not cookie) — avoids SameSite/Secure issues
  res.redirect(\`/#session=\${sessionToken}\`);
});`,
      lines: [
        {
          lines: "4-9",
          label: "CSRF state validation",
          explanation:
            "The `state` param is a UUID generated at redirect time and stored in Redis with a short TTL. On callback, it must match. If it doesn't (e.g. attacker-constructed URL, replayed callback), the flow aborts. `redis.del` after validation ensures one-time use — a replayed callback with the same `state` fails.",
        },
        {
          lines: "22",
          label: "decode, don't verify",
          explanation:
            "Google has already verified the ID token's signature (it came directly from Google's token endpoint over TLS). Decoding without verifying avoids an extra round-trip to Google's public key endpoint. This is safe ONLY when the token comes from the token exchange response — never trust a client-supplied ID token this way.",
        },
        {
          lines: "33-34",
          label: "URL fragment delivery",
          explanation:
            "Fragments (`#session=...`) are never sent to the server in subsequent requests — they exist only in the browser. This avoids SameSite cookie issues on cross-origin iframes and lets the SPA strip the token from the URL before writing to localStorage.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "How the session is used on every request",
      paragraphs: [
        "The frontend stores the JWT in `localStorage['voiceorch:session']` and attaches it to every API request as an `Authorization: Bearer <jwt>` header (via TanStack Query's `setAuthTokenGetter`). For SSE endpoints that can't set headers, the token is passed as `?token=<jwt>`.",
        "`attachSession` middleware (`middlewares/session.ts`) validates the JWT on every request: checks the HS256 signature with `SESSION_SECRET`, verifies `exp` hasn't passed, and sets `req.clerkUserId = payload.sub` and `req.sessionPayload = payload`. Downstream route handlers call `getAuth(req).userId` — a shim that reads `req.clerkUserId` — preserving the ~20 file call sites that pre-date the migration.",
        "The `users.clerk_id` column stores the Google `sub` (not renamed to avoid schema migration friction). `getAuth` is defined in `lib/auth-compat.ts` and is a 3-line shim — if you ever see `req.clerkUserId` in route code, it is the Google `sub`, not a Clerk ID.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "SESSION_SECRET must be a strong, randomly-generated secret",
      body: [
        "`SESSION_SECRET` is the symmetric key for HS256 JWT signing. Anyone who knows this secret can mint valid session tokens for any user. It must be: at least 32 bytes of cryptographic randomness, stored as an environment variable (never in source code), and rotated if ever exposed.",
        "Rotating `SESSION_SECRET` immediately invalidates all existing sessions — every user will be logged out. Plan rotations for low-traffic windows and communicate them to users in advance.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is the session JWT delivered via the URL fragment (#session=...) rather than a Set-Cookie header?",
          choices: [
            "Cookies are less secure than localStorage for JWTs",
            "Fragments avoid SameSite and Secure cookie restrictions in cross-origin iframes and allow the SPA to strip the token from the URL",
            "Express cannot set cookies on redirects",
            "Google's OAuth terms of service prohibit cookie-based session storage",
          ],
          correctIndex: 1,
          explanation:
            "SameSite cookie restrictions (`SameSite=Lax`) prevent cookies from being sent on cross-site navigations, which breaks OAuth redirects. `SameSite=None; Secure` requires HTTPS. Fragments sidestep all this — they're client-only, never sent to the server, and let the SPA clean up the URL immediately after reading the token.",
        },
        {
          prompt: "A route handler calls `getAuth(req).userId`. What does this return?",
          choices: [
            "The user's internal Postgres integer ID from the `users` table",
            "The user's Clerk user ID (starts with 'user_')",
            "The user's Google OAuth `sub` (numeric string, stored in `users.clerk_id`)",
            "The user's email address",
          ],
          correctIndex: 2,
          explanation:
            "`getAuth` is a shim in `lib/auth-compat.ts` that reads `req.clerkUserId`, which `attachSession` sets to `payload.sub` — the Google `sub` from the JWT. The column is named `clerk_id` for historical reasons but stores the Google sub. It's a string like `'106...'`, not `'user_...'`.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "No Clerk/Passport — platform-owned Google OAuth app + self-issued HS256 JWT",
        "CSRF protection: `state` nonce stored in Redis, one-time use, validated on callback",
        "JWT delivered via URL fragment (#session=...) — never a cookie",
        "`req.clerkUserId` = Google `sub` — the column and field name are legacy from the Clerk era",
        "`SESSION_SECRET` rotation invalidates all sessions — plan it carefully",
      ],
    },
  ],
};
