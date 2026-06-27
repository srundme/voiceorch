import type { Chapter } from "../types";

export const serverBootstrap: Chapter = {
  slug: "server-bootstrap",
  moduleId: "m3",
  number: "3.2",
  title: "Server Bootstrap: index.ts Line by Line",
  summary:
    "How the server starts: binding the port, the WebSocket upgrade handler, migrations, and background workers.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/index.ts",
  prerequisites: ["express-app"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "`app.ts` built the Express request pipeline, but an Express app is just an object — it doesn't *listen* to anything by itself. `index.ts` is the **entry point**: the file Node actually runs. It takes the assembled app, wraps it in a real HTTP server, teaches that server how to handle WebSocket upgrades (which is how live phone audio arrives), binds the port, runs database migrations, and kicks off all the background workers that keep the platform humming.",
        "This is the file that decides the **order of startup** — and that order is carefully chosen so a deploy never drops calls. Crucially, the server starts listening **before** migrations run, so the health check passes immediately while the schema catches up in the background. Master `index.ts` and you understand the whole lifecycle of the process: birth, work, and graceful death.",
      ],
    },
    {
      kind: "concept",
      title: "HTTP servers, WebSockets, and the 'upgrade'",
      body: [
        "A normal HTTP request is one-and-done: ask, answer, hang up. But a phone call is a continuous **stream** of audio frames in both directions — that needs a persistent, two-way pipe. That pipe is a **WebSocket**.",
        "A WebSocket starts life as an ordinary HTTP request carrying a special `Upgrade: websocket` header. The server can choose to 'upgrade' that connection from request/response into a long-lived socket. Node exposes this as the `'upgrade'` event on the HTTP server. SnapServe listens for it, checks the URL to figure out which telephony provider is calling, and hands the socket to the right handler.",
        "Because both the Express app (HTTP) and the WebSocket logic share **one** underlying server and **one** port, the bootstrap has to wire them together by hand — `http.createServer(app)` for the HTTP side, and `server.on('upgrade', ...)` for the socket side.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/index.ts",
      language: "typescript",
      intro:
        "First, read and validate the port, then install process-wide safety nets so one stray async error can't kill the whole server mid-call.",
      code: `const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(\`Invalid PORT value: "\${rawPort}"\`);

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — caught at process level (process kept alive)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — caught at process level (process kept alive)");
});`,
      lines: [
        {
          lines: "1-4",
          label: "read & validate PORT",
          explanation:
            "The port comes from an environment variable (Railway injects it). The code **fails loudly** if it's missing or nonsensical, rather than silently defaulting — a missing port should crash at boot, not produce a mysterious 'connection refused' later.",
        },
        {
          lines: "6-8",
          label: "unhandledRejection net",
          explanation:
            "Node 15+ will **exit the process** on an unhandled promise rejection by default. As the comment in the file warns, one transient DB timeout inside a `ws.on('close')` callback would otherwise kill the server and 502 every in-flight call. This handler catches it and just logs.",
        },
        {
          lines: "9-11",
          label: "uncaughtException net",
          explanation:
            "Same idea for synchronous throws that escape everything. We'd rather log and stay alive than crash and drop live calls. (In a stricter system you'd restart — here, keeping calls connected wins.)",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Why keep the process alive on errors?",
      body: [
        "Most tutorials tell you to crash-and-restart on an uncaught error. SnapServe deliberately does the opposite: a voice platform with dozens of **live phone calls** in flight can't afford to vanish because one background `close` handler hit a DB hiccup.",
        "The trade-off is honest: you risk running in a slightly degraded state. But for real-time calls, 'stay up and log it' beats 'drop everyone and reboot'.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/index.ts",
      language: "typescript",
      intro:
        "Now create the actual HTTP server from the Express app, and attach a WebSocket server in 'noServer' mode so we control the upgrade handshake ourselves.",
      code: `installSharedHttpPool();

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });`,
      lines: [
        {
          lines: "1",
          label: "installSharedHttpPool()",
          explanation:
            "Before any outbound provider call can happen, install a shared keep-alive HTTP connection pool as the global dispatcher. This keeps TCP+TLS sockets warm between conversational turns so repeat LLM/TTS/STT calls skip the expensive handshake — a real latency win on every turn.",
        },
        {
          lines: "3",
          label: "http.createServer(app)",
          explanation:
            "Wraps the Express `app` (from the last chapter) in a Node HTTP server. The app handles ordinary requests; the raw server gives us the low-level `'upgrade'` event WebSockets need.",
        },
        {
          lines: "5",
          label: 'new WebSocketServer({ noServer: true })',
          explanation:
            "`noServer: true` means the ws library does **not** bind its own port or auto-handle upgrades. We want to authenticate and rate-limit the upgrade ourselves first, then call `wss.handleUpgrade(...)` manually. Full control over the handshake.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/index.ts",
      language: "typescript",
      intro:
        "The upgrade handler is the front door for live calls. It parses the URL to find the provider and agent, redacts secrets before logging, and rate-limits per IP.",
      code: `server.on("upgrade", (request, socket, head) => { void (async () => {
  const url = request.url ?? "";

  // Redact the session JWT (and any future secret query params) before ANY logging
  const safeUrl = url.replace(/([?&](?:token|auth)=)[^&]*/gi, "$1[redacted]");

  // Match /api/ws/<provider>/<agentId>[?pt=1]
  const match = url.match(/^\\/api\\/ws\\/(twilio|plivo|vobiz|webcall)\\/(\\d+)/);
  if (!match) {
    socket.destroy();
    return;
  }

  const provider          = match[1] as "twilio" | "plivo" | "vobiz" | "webcall";
  const agentId           = parseInt(match[2]!, 10);
  const platformTelephony = url.includes("pt=1");`,
      lines: [
        {
          lines: "1",
          label: 'server.on("upgrade", ...)',
          explanation:
            "Fires whenever a client requests a protocol upgrade to WebSocket. The whole body is wrapped in `void (async () => { ... })()` so it can `await` a DB ownership check without making the event listener itself async (which Node's event emitter wouldn't await anyway).",
        },
        {
          lines: "4-5",
          label: "redact secrets before logging",
          explanation:
            "The webcall transport carries `?token=<JWT>` in the URL. This regex replaces any `token=` or `auth=` value with `[redacted]` so the secret never reaches the logs — including the rate-limit warning below. A small but vital security habit.",
        },
        {
          lines: "8-12",
          label: "match the provider + agent",
          explanation:
            "The URL must look like `/api/ws/<provider>/<agentId>`. If it doesn't match the whitelist of four providers, `socket.destroy()` slams the door — no allocation, no handler. Unknown URLs get nothing.",
        },
        {
          lines: "14-16",
          label: "extract provider, agentId, flags",
          explanation:
            "Pull the captured groups: which provider is calling, which agent this call is for, and whether it's using platform telephony (`pt=1`). These drive the `switch` that routes the socket to the right handler.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/index.ts",
      language: "typescript",
      intro:
        "Web calls from the browser are special: unlike a phone provider, the browser CAN present a token — so we require a valid session JWT AND prove the user owns the agent before allocating anything.",
      code: `  let webcallUserId: string | null = null;
  if (provider === "webcall") {
    const token   = qs.get("token");
    const payload = token ? verifySessionToken(token) : null;
    if (!payload) {
      socket.write("HTTP/1.1 401 Unauthorized\\r\\nContent-Length: 0\\r\\n\\r\\n");
      socket.destroy();
      return;
    }
    let agentRow: { userId: string | null } | undefined;
    // ... look up the agent's owner in the DB ...
    if (!agentRow || agentRow.userId !== payload.sub) {
      socket.write("HTTP/1.1 403 Forbidden\\r\\nContent-Length: 0\\r\\n\\r\\n");
      socket.destroy();
      return;
    }
    webcallUserId = payload.sub;
  }

  wss.handleUpgrade(request, socket, head, (ws: import("ws").WebSocket) => {
    switch (provider) {
      case "twilio":   void handleTwilioWebSocket(ws, agentId, campaignLeadId);   break;
      case "plivo":    void handlePlivoWebSocket(ws, agentId, campaignLeadId);    break;
      case "vobiz":    void handleVobizWebSocket(ws, agentId, platformTelephony, campaignLeadId, vobizFrom, vobizTo, voicemailDelivery); break;
      case "webcall":  void handleWebcallWebSocket(ws, agentId, webcallUserId!);  break;
    }
  });
})(); });`,
      lines: [
        {
          lines: "2-9",
          label: "verify the session token",
          explanation:
            "A browser can authenticate, so a webcall **must** carry a valid session JWT in `?token=`. `verifySessionToken` checks the HS256 signature and expiry. No valid payload → write a raw `401` straight to the socket and destroy it. (Telephony providers can't send a token, so they skip this.)",
        },
        {
          lines: "11-16",
          label: "ownership check before allocation",
          explanation:
            "Even with a valid token, the authenticated user must **own** the agent they're trying to talk to. If `agentRow.userId !== payload.sub`, write a `403` and destroy. Enforcing this *before* `handleUpgrade` means an unauthorized request never allocates a session or socket.",
        },
        {
          lines: "19-26",
          label: "wss.handleUpgrade + switch",
          explanation:
            "Only now do we complete the WebSocket handshake. The callback receives the live `ws` socket; the `switch` hands it to the provider-specific handler that knows how to decode that provider's audio frames. Each is wrapped in `void` because they're long-running async functions we don't await here.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Migrations: keeping the database schema in step",
      body: [
        "A **migration** is a versioned change to the database schema (add a column, create a table). Drizzle keeps a journal table — `drizzle.__drizzle_migrations` — listing which migrations have already run, so on each boot it only applies the *new* ones.",
        "SnapServe has a wrinkle: some production databases were originally bootstrapped with `drizzle-kit push` (which creates tables but writes **no** journal). If `migrate()` ran against such a DB it would try to re-create tables that already exist and explode. So `bootstrapMigrationJournal()` runs first to seed the journal with the known historical migrations, marking them 'already applied' — *then* `migrate()` only runs anything genuinely new.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/index.ts",
      language: "typescript",
      intro:
        "The grand finale: bind the port FIRST (so health checks pass), warm up audio + VAD, then run migrations and start the background workers in the background.",
      code: `server.listen(port, () => {
  logger.info({ port }, "Server listening");
  initAudioPool(new URL(\`file://\${workerFile}\`));
  void warmSileroVAD(); // preload Silero VAD ONNX session so first call doesn't pay load cost

  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../../lib/db/drizzle");
  bootstrapMigrationJournal()
    .then(() => migrate(db, { migrationsFolder }))
    .then(() => {
      logger.info({ migrationsFolder }, "DB migrations applied");
      void seedManagedKeyFromEnv("managed_qwen_key",     "GROQ_API_KEY");
      void migrateSaarikaToSaaras();
      void runBetaCreditMigration();
      startCallbackPoller();
      startSpikeChecker();
      startAlertSweep();
      startRateLimitCleanup();
      startBatchScheduler();
      startDpdpRetentionSweep();
      startVobizWalletMonitor();
    })
    .catch((err: unknown) => {
      logger.error({ err, migrationsFolder }, "DB migration failed — server will stay up for diagnostics");
    });
});`,
      lines: [
        {
          lines: "1-2",
          label: "server.listen(port, ...)",
          explanation:
            "Binds the port and starts accepting connections. The callback runs once the socket is open. Per the file's comment, the server listens **first** so Railway's health-check probe can reach `/api/healthz` immediately — migrations run *after* the port is bound, in the background.",
        },
        {
          lines: "3-4",
          label: "warm the audio engine",
          explanation:
            "`initAudioPool` spins up worker threads for audio processing, and `warmSileroVAD()` preloads the voice-activity-detection neural net. Doing this at boot means the **first** real call doesn't pay the cold-start load cost.",
        },
        {
          lines: "7-8",
          label: "bootstrapMigrationJournal().then(migrate)",
          explanation:
            "Seed the journal for legacy push-bootstrapped DBs, THEN run `migrate()` so it only applies genuinely new migrations. Chaining with `.then` guarantees the order: journal first, migrate second.",
        },
        {
          lines: "10-20",
          label: "seed keys + start workers",
          explanation:
            "Once the schema is ready, seed managed provider keys from env, run one-shot data migrations, and start every background worker: callback poller, spike checker, usage alert sweep, rate-limit cleanup, batch scheduler, DPDP retention sweep, and the Vobiz wallet monitor.",
        },
        {
          lines: "21-23",
          label: ".catch — stay up on failure",
          explanation:
            "If migration fails, log it but **do not exit**. Keeping the process alive lets the health check pass and lets an engineer inspect the error in the console — instead of a crash-loop that hides the cause.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Impersonation needs migration 0012",
      body: [
        "Per `replit.md`: `POST /api/admin/impersonate/:clerkId` writes an `exchange_code` column in its initial INSERT. If migration `0012_impersonation_exchange_code` hasn't reached the production DB, that INSERT fails with an 'unknown column' error and 'Login As User' breaks.",
        "This is exactly the kind of thing the journal-bootstrap dance is protecting against — the schema and the code must move together, or features fail in confusing ways.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "index.ts is the lifecycle conductor. Click any box to jump to its chapter.",
      nodes: [
        { id: "index", label: "index.ts", sublabel: "THIS FILE — entry point", current: true },
        { id: "app", label: "app.ts", sublabel: "the Express app it wraps", chapterSlug: "express-app" },
        { id: "session", label: "verifySessionToken", sublabel: "webcall auth", chapterSlug: "middleware-and-auth" },
        { id: "telephony", label: "telephony handlers", sublabel: "twilio / plivo / vobiz", chapterSlug: "telephony-overview" },
        { id: "webcall", label: "handleWebcallWebSocket", sublabel: "browser live test", chapterSlug: "webcall" },
        { id: "migrations", label: "drizzle migrate()", sublabel: "schema in step", chapterSlug: "migrations" },
      ],
      edges: [
        { from: "index", to: "app", label: "http.createServer(app)" },
        { from: "index", to: "session", label: "verify ?token=" },
        { from: "index", to: "telephony", label: "upgrade → handler" },
        { from: "index", to: "webcall", label: "upgrade → handler" },
        { from: "index", to: "migrations", label: "after listen()" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt:
            "Why does the server call `server.listen(port)` BEFORE running database migrations?",
          choices: [
            "Migrations require an open port.",
            "So the health-check probe can reach the server immediately while migrations finish in the background.",
            "Because listen() runs the migrations.",
            "To save memory.",
          ],
          correctIndex: 1,
          explanation:
            "Binding the port first means Railway's health check passes right away. Migrations then run in the background after listen, so a slow schema change never makes the deploy look unhealthy.",
        },
        {
          prompt:
            "What does `bootstrapMigrationJournal()` solve before `migrate()` runs?",
          choices: [
            "It backs up the database.",
            "It seeds the Drizzle journal for DBs originally created via push (no journal) so migrate() only runs genuinely new migrations.",
            "It deletes old tables.",
            "It opens the WebSocket server.",
          ],
          correctIndex: 1,
          explanation:
            "Some prod DBs were bootstrapped with `drizzle-kit push`, which creates tables but writes no journal. Seeding the journal marks historical migrations as applied so `migrate()` won't try to re-create existing tables.",
        },
        {
          prompt:
            "Why is the webcall upgrade required to verify a session token while Twilio/Plivo/Vobiz upgrades are not?",
          choices: [
            "Phone providers are more trustworthy.",
            "The browser can present a session JWT, so we require it and an ownership check; inbound provider connections cannot send a bearer token.",
            "Web calls don't carry audio.",
            "It's a bug.",
          ],
          correctIndex: 1,
          explanation:
            "A browser can authenticate, so the webcall path demands a valid JWT in `?token=` plus proof the user owns the agent — enforced before allocating a socket. Telephony providers connect inbound and can't present a token.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "index.ts is the entry point: it wraps the Express app in an HTTP server, binds the port, and owns the process lifecycle.",
        "WebSocket upgrades (live call audio) are handled manually via `server.on('upgrade')` with per-IP rate limiting and secret redaction.",
        "Web calls must present a valid session JWT and pass an ownership check before a socket is ever allocated.",
        "The server listens FIRST so health checks pass, then runs migrations and background workers in the background.",
        "`bootstrapMigrationJournal()` seeds the Drizzle journal for legacy push-created DBs so `migrate()` only applies new migrations.",
        "Process-level `unhandledRejection`/`uncaughtException` handlers keep the server alive rather than dropping live calls.",
      ],
    },
  ],
};
