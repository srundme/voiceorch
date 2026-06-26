import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import { attachSession } from "./middlewares/session.js";
import { detectImpersonation } from "./middlewares/detectImpersonation.js";
import router from "./routes";
import { logger } from "./lib/logger";
import { ipRateLimit, authRateLimit, isRateLimitExempt } from "./lib/rate-limit.js";

const app: Express = express();
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
);

import { getAppOrigins } from "./lib/app-domain.js";

// In production restrict CORS to known dashboard origins; in dev allow all.
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
app.use(express.urlencoded({ extended: true }));

// IP-based rate limiting (outer shield) — skip exempt paths
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

app.use("/api", router);

// Serve admin panel at /admin-ui/ when ADMIN_DIST_PATH is set (production / Railway)
const adminDistPath = process.env["ADMIN_DIST_PATH"];
if (adminDistPath) {
  const adminAbs = path.isAbsolute(adminDistPath)
    ? adminDistPath
    : path.join(process.cwd(), adminDistPath);
  if (existsSync(adminAbs)) {
    logger.info({ adminAbs }, "Serving admin panel at /admin-ui/");
    app.use("/admin-ui", express.static(adminAbs));
    app.get(/^\/admin-ui(\/.*)?$/, (_req, res) => {
      res.sendFile(path.join(adminAbs, "index.html"));
    });
  } else {
    logger.warn({ adminAbs }, "ADMIN_DIST_PATH set but directory not found — skipping admin static serving");
  }
}

// Serve the built React SPA when FRONTEND_DIST_PATH is set (production / Railway)
const frontendDistPath = process.env["FRONTEND_DIST_PATH"];
if (frontendDistPath) {
  const distAbs = path.isAbsolute(frontendDistPath)
    ? frontendDistPath
    : path.join(process.cwd(), frontendDistPath);

  if (existsSync(distAbs)) {
    logger.info({ distAbs }, "Serving frontend static files");
    app.use(express.static(distAbs));
    // SPA fallback — send index.html for any non-/api and non-/admin-ui route
    app.get(/^\/(?!api|admin-ui).*/, (_req, res) => {
      res.sendFile(path.join(distAbs, "index.html"));
    });
  } else {
    logger.warn({ distAbs, FRONTEND_DIST_PATH: frontendDistPath }, "FRONTEND_DIST_PATH set but directory not found — skipping static serving");
  }
}

export default app;
