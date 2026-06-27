import type { Chapter } from "../types";

export const expressApp: Chapter = {
  slug: "express-app",
  moduleId: "m3",
  number: "3.1",
  title: "Express in 20 Minutes",
  summary:
    "Requests, responses, routers, and middleware — the four ideas the entire backend is built on.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/app.ts",
  prerequisites: ["async-await-promises"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Every dashboard click, every webhook from Twilio, every 'create agent' button press eventually becomes an **HTTP request** that lands on the SnapServe backend. Something has to receive that request, figure out who sent it, check they're allowed, route it to the right handler, and send a response back. That something is **Express** — the tiny web framework the whole API server is built on.",
        "`app.ts` is where the Express application is **assembled**. It doesn't contain a single business rule — no agents, no calls, no billing. Instead it wires together a pipeline of **middleware** (logging, CORS, body parsing, rate limiting, authentication) that every request flows through, then hands the request off to the routers. Read this one file and you understand the shape of every request the server will ever handle.",
      ],
    },
    {
      kind: "concept",
      title: "The four ideas: request, response, router, middleware",
      body: [
        "A **request** is an incoming message: a method (`GET`, `POST`, `PATCH`…), a URL (`/api/agents/42`), headers (who am I, what format do I want), and maybe a body (JSON data). A **response** is what you send back: a status code (`200` OK, `404` Not Found), headers, and a body.",
        "A **router** is a phone-book that maps URL patterns to functions. `GET /api/agents` → 'list this user's agents'. SnapServe has dozens of routers (agents, calls, billing, scheduling…) all mounted under `/api`.",
        "**Middleware** is the key idea. A middleware is a function that sits in the request's path and can inspect it, modify it, or stop it — then calls `next()` to pass it along. Express runs your middleware **in the exact order you register them with** `app.use(...)`. That order is everything: you must parse the body before you can read it, attach the session before you can rate-limit by user, and authenticate before you route to a protected handler.",
      ],
    },
    {
      kind: "analogy",
      title: "An airport security line",
      body: [
        "Picture a passenger (the request) walking through an airport. First the **check-in desk** logs them (request logging). Then a **gate** decides if their airline is even allowed here (CORS). Then **baggage screening** unpacks their suitcase so it can be inspected (body parsing). Then a **first checkpoint** turns away anyone showing up too often (IP rate limit). Then **passport control** stamps their identity onto them (attachSession). Only after all those stations does the passenger reach their actual **gate** (the router and route handler).",
        "Each station can wave you through (`next()`) or stop you cold (send a response and return). Express middleware is exactly this line of stations — and `app.ts` is the floor plan that decides their order.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/app.ts",
      language: "typescript",
      intro:
        "The file opens by creating the app and registering the very first middleware: structured request logging.",
      code: `const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);`,
      lines: [
        {
          lines: "1",
          label: "express()",
          explanation:
            "Calling `express()` builds a fresh application object. Everything else in the file configures this one `app`, and the very last line exports it for `index.ts` to wrap in an HTTP server.",
        },
        {
          lines: "2",
          label: 'app.set("trust proxy", 1)',
          explanation:
            "In production the server sits behind a proxy (Railway's load balancer). This tells Express to trust the `X-Forwarded-For` header so it can see the **real** client IP — essential for the IP rate limiter to work correctly instead of seeing the proxy's IP every time.",
        },
        {
          lines: "4-23",
          label: "app.use(pinoHttp(...))",
          explanation:
            "The first middleware. `pinoHttp` logs one line per request. The `serializers` trim each log entry to just the id, method, and URL (with the `?query` stripped) on the way in, and the status code on the way out — keeping logs readable and never leaking secrets that live in query strings.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/app.ts",
      language: "typescript",
      intro:
        "Next, CORS and body parsing — the gate that decides who may talk to us, and the unpacking of the request body.",
      code: `// In production restrict CORS to known dashboard origins; in dev allow all.
const corsOrigin: string | string[] | boolean = (() => {
  if (process.env["NODE_ENV"] !== "production") return true;
  const allowed: string[] = ["https://app.snapserve.ai", ...getAppOrigins()];
  return [...new Set(allowed)];
})();
app.use(cors({ credentials: true, origin: corsOrigin }));
app.use(cookieParser());
// Capture raw body bytes so HMAC-based webhook signature verification
// always operates on the exact bytes the sender signed, not a re-serialized
// version that may differ in whitespace.
app.use(express.json({
  verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));`,
      lines: [
        {
          lines: "2-6",
          label: "compute the allowed origins",
          explanation:
            "An immediately-invoked function works out which browser origins may call the API. In dev it returns `true` (allow everyone, for convenience). In production it returns an explicit allow-list — the marketing domain plus any app origins — so a random website can't make authenticated calls on a user's behalf.",
        },
        {
          lines: "7",
          label: "cors({ credentials: true, ... })",
          explanation:
            "Registers the CORS middleware. `credentials: true` lets the browser send cookies/Authorization headers cross-origin, which the dashboard needs to stay logged in.",
        },
        {
          lines: "12-16",
          label: "express.json({ verify })",
          explanation:
            "Parses JSON request bodies into `req.body`. The clever bit is the `verify` callback: it stashes the **raw bytes** on `req.rawBody` before parsing. Webhook signature checks must hash the exact bytes the sender signed — re-serializing the parsed JSON could change whitespace and break the signature.",
        },
        {
          lines: "17",
          label: "express.urlencoded",
          explanation:
            "Parses traditional HTML form submissions (`application/x-www-form-urlencoded`) — used by some telephony providers that POST form bodies rather than JSON.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Why capture the raw body at all?",
      body: [
        "Once `express.json()` parses a body, the original bytes are gone — you only have the JavaScript object. But HMAC webhook verification must re-hash the **exact** bytes the sender signed. If you stringify the parsed object back, a single different space or key order yields a different hash and every webhook fails signature verification.",
        "That's why the `verify` hook squirrels away `req.rawBody` at parse time. It's a small detail with big consequences — and a classic source of 'works locally, fails in prod' webhook bugs.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/app.ts",
      language: "typescript",
      intro:
        "Now the security sandwich: an outer IP-based rate limit, then identity, then an inner per-user rate limit. Order matters enormously here.",
      code: `// IP-based rate limiting (outer shield) — skip exempt paths
app.use((req, res, next) => {
  if (isRateLimitExempt(req.url)) {
    next();
  } else {
    ipRateLimit(req, res, next);
  }
});

// Validate the platform session token (Bearer or ?token=) and populate
// req.clerkUserId / req.sessionPayload before rate limiting + routing.
app.use(attachSession);

// Detect active admin impersonation sessions and register per-action audit hooks.
app.use(detectImpersonation);

// Auth-based rate limiting (inner shield, after session is attached) — skip exempt paths
app.use((req, res, next) => {
  if (isRateLimitExempt(req.url)) {
    next();
  } else {
    authRateLimit(req, res, next);
  }
});

app.use("/api", router);`,
      lines: [
        {
          lines: "2-8",
          label: "ipRateLimit (outer shield)",
          explanation:
            "Before we know who anyone is, we limit by raw IP address — a blunt shield against floods and credential-stuffing. Certain paths (`isRateLimitExempt`) like health checks skip it so monitoring never gets throttled.",
        },
        {
          lines: "12",
          label: "attachSession",
          explanation:
            "The identity station. It validates the session JWT (from the `Authorization: Bearer` header or `?token=` query) and, if valid, sets `req.clerkUserId` and `req.sessionPayload`. It never rejects — it only annotates. Enforcement is left to `requireAuth` inside the routes. (Whole chapter on this next.)",
        },
        {
          lines: "15",
          label: "detectImpersonation",
          explanation:
            "Admins can 'Login As User' for support. This middleware spots an active impersonation session and wires up audit hooks so every action taken while impersonating is logged.",
        },
        {
          lines: "18-24",
          label: "authRateLimit (inner shield)",
          explanation:
            "A second, finer rate limit that keys on the **authenticated user id** — which only exists because `attachSession` ran first. This is why ordering matters: you can't rate-limit per user before you know the user.",
        },
        {
          lines: "26",
          label: 'app.use("/api", router)',
          explanation:
            "The hand-off. Every request that survived the middleware gauntlet and starts with `/api` is delegated to the big combined router (`routes/index.ts`), which dispatches to the agents, calls, billing, scheduling… sub-routers.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/app.ts",
      language: "typescript",
      intro:
        "After the API, the same app optionally serves the built React frontends as static files — this is how one process can serve both the API and the dashboard in production.",
      code: `// Serve the built React SPA when FRONTEND_DIST_PATH is set (production / Railway)
const frontendDistPath = process.env["FRONTEND_DIST_PATH"];
if (frontendDistPath) {
  const distAbs = path.isAbsolute(frontendDistPath)
    ? frontendDistPath
    : path.join(process.cwd(), frontendDistPath);

  if (existsSync(distAbs)) {
    logger.info({ distAbs }, "Serving frontend static files");
    app.use(express.static(distAbs));
    // SPA fallback — send index.html for any non-/api and non-/admin-ui route
    app.get(/^\\/(?!api|admin-ui).*/, (_req, res) => {
      res.sendFile(path.join(distAbs, "index.html"));
    });
  }
}

export default app;`,
      lines: [
        {
          lines: "2-3",
          label: "guarded by an env var",
          explanation:
            "Static serving only switches on when `FRONTEND_DIST_PATH` is set (production). In local dev the React app runs on its own Vite server, so this whole block is skipped.",
        },
        {
          lines: "10",
          label: "express.static",
          explanation:
            "Serves the compiled JS/CSS/images of the dashboard straight off disk — fast, no route handler needed.",
        },
        {
          lines: "12-14",
          label: "SPA fallback",
          explanation:
            "A single-page app handles its own routing in the browser. This regex catches any path that is **not** `/api` or `/admin-ui` and returns `index.html`, so a deep link like `/agents/42` loads the app shell and lets React Router take over.",
        },
        {
          lines: "18",
          label: "export default app",
          explanation:
            "The fully-wired app is exported. `index.ts` imports it, wraps it in a Node HTTP server, attaches the WebSocket upgrade handler, and binds the port — the subject of the next chapter.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "app.ts is the assembly point. Click any box to jump to its chapter.",
      nodes: [
        { id: "index", label: "index.ts", sublabel: "wraps app in an HTTP server", chapterSlug: "server-bootstrap" },
        { id: "app", label: "app.ts", sublabel: "THIS FILE — middleware pipeline", current: true },
        { id: "session", label: "attachSession", sublabel: "identity middleware", chapterSlug: "middleware-and-auth" },
        { id: "router", label: "routes/index.ts", sublabel: "mounts every sub-router", chapterSlug: "routes-anatomy" },
        { id: "agents", label: "agents router", sublabel: "a real route handler", chapterSlug: "routes-anatomy" },
      ],
      edges: [
        { from: "index", to: "app", label: "imports app" },
        { from: "app", to: "session", label: "app.use(attachSession)" },
        { from: "app", to: "router", label: 'app.use("/api", router)' },
        { from: "router", to: "agents", label: "dispatch" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt:
            "Why must `attachSession` be registered before the auth-based rate limiter (`authRateLimit`)?",
          choices: [
            "Because alphabetical order is required.",
            "The auth rate limiter keys on the user id, which only exists after attachSession sets req.clerkUserId.",
            "It makes the logs prettier.",
            "Rate limiters must always run last.",
          ],
          correctIndex: 1,
          explanation:
            "Middleware runs in registration order. `authRateLimit` limits per authenticated user, so the user must already be attached to the request — which is `attachSession`'s job. Reverse the order and the per-user limit would have no user to key on.",
        },
        {
          prompt:
            "What is the purpose of the `verify` callback passed to `express.json()`?",
          choices: [
            "To reject invalid JSON.",
            "To stash the raw request bytes on req.rawBody so HMAC webhook signatures can be verified against the exact bytes the sender signed.",
            "To pretty-print the body.",
            "To convert the body to a Buffer for the database.",
          ],
          correctIndex: 1,
          explanation:
            "Parsing destroys the original byte stream. The `verify` hook captures `req.rawBody` before parsing so webhook signature checks hash the precise bytes that were signed, not a re-serialized version.",
        },
        {
          prompt: "What does `app.use(\"/api\", router)` do?",
          choices: [
            "Blocks all /api requests.",
            "Mounts the combined router so any request beginning with /api is delegated to the sub-routers.",
            "Serves static files from /api.",
            "Enables CORS for /api only.",
          ],
          correctIndex: 1,
          explanation:
            "It mounts the big combined router under the `/api` prefix. After the middleware pipeline finishes, matching requests are handed to `routes/index.ts`, which dispatches to agents, calls, billing, and the rest.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Express is built on four ideas: request, response, router, and middleware.",
        "Middleware runs in the exact order you register it with `app.use(...)` — ordering is a feature, not an accident.",
        "app.ts wires the pipeline: logging → CORS → body parsing → IP rate limit → attachSession → impersonation → auth rate limit → router.",
        "`attachSession` only annotates the request with identity; it never rejects — enforcement lives in the routes.",
        "The same process can also serve the built React SPA via `express.static` plus a regex SPA fallback in production.",
        "app.ts contains zero business logic — it's pure assembly; the real work lives in the routers it mounts.",
      ],
    },
  ],
};
