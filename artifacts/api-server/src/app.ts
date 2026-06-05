import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { attachSession } from "./middlewares/session.js";
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

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
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

// Auth-based rate limiting (inner shield, after session is attached) — skip exempt paths
app.use((req, res, next) => {
  if (isRateLimitExempt(req.url)) {
    next();
  } else {
    authRateLimit(req, res, next);
  }
});

app.use("/api", router);

export default app;
