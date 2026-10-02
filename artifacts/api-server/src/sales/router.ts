import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import {
  acceptInvite,
  bootstrapFounderInvite,
  findValidInvite,
  hashToken,
  inviteUser,
  listTeam,
  listUsers,
  login,
  normalizeLoginEmail,
  resolveSession,
  revokeInvite,
  revokeSessionByToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  updateUser,
  type SessionMeta,
} from "./auth-service.js";
import { cancelActivity, createActivity, listActivities, updateActivity } from "./activity-service.js";
import {
  addContact,
  assignCompanyOwner,
  createCompany,
  createOpportunity,
  deleteContact,
  getCompanyDetail,
  listCompanies,
  updateCompany,
  updateContact,
} from "./company-service.js";
import { getCalendar } from "./calendar-service.js";
import { SalesError, type SalesActor, type SalesDb } from "./db.js";
import { resolveDedupeReview } from "./dedupe-service.js";
import { clearDemo, demoStatus, seedDemo } from "./demo-service.js";
import { createExpense, deleteExpense, listExpenses, updateExpense } from "./expense-service.js";
import { EXPORT_KINDS, exportCsv, type ExportKind } from "./export-service.js";
import { commitLeadImport, previewLeadImport } from "./import-service.js";
import { changeStage, getOpportunity, updateOpportunity } from "./opportunity-service.js";
import { adjustPayment, listPayments, recordPayment, rejectPayment, verifyPayment } from "./payment-service.js";
import {
  addSnapshot,
  changePilotStatus,
  createPilot,
  extendPilot,
  getPilot,
  importSnapshots,
  listPilots,
  pilotReport,
  updatePilot,
} from "./pilot-service.js";
import { acceptProposal, createProposal, declineProposal, listProposals, sendProposal, updateProposal } from "./proposal-service.js";
import { getReports } from "./report-service.js";
import * as s from "./schemas.js";
import { generateTargets, getSettings, listTargets, putSettings, updateTarget } from "./settings-service.js";
import { ALL_STAGES, ORDERED_STAGES, SIDE_STAGES } from "./stages.js";
import {
  cancelSubscription,
  createSubscription,
  getSubscription,
  goLive,
  listSubscriptions,
  pauseSubscription,
  resumeSubscription,
  updateSubscription,
} from "./subscription-service.js";
import { assignTask, createTask, finishTask, listTasks, updateTask } from "./task-service.js";
import { getToday } from "./today-service.js";
import { EVENT_ID_HEADER, ingestLeadWebhook, SIGNATURE_HEADER, verifySignature } from "./webhook-service.js";

type SalesRequest = Request & { salesUser?: SalesActor; salesSessionId?: number };
type Handler = (req: SalesRequest, res: Response) => Promise<void>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "strict" as const,
    path: "/api/sales",
  };
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

function sessionToken(req: Request): string | null {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
  return typeof value === "string" && value ? value : null;
}

function sessionMeta(req: Request): SessionMeta {
  return { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

function actorOf(req: SalesRequest): SalesActor {
  if (!req.salesUser) throw new SalesError(401, "Not signed in");
  return req.salesUser;
}

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new SalesError(400, "Invalid request", { details: parsed.error.flatten() });
  return parsed.data;
}

function parseId(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new SalesError(400, "Invalid id");
  return n;
}

function handle(fn: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req as SalesRequest, res);
    } catch (err) {
      if (err instanceof SalesError) {
        res.status(err.status).json({ error: err.message, ...err.extra });
        return;
      }
      logger.error({ err, path: req.path }, "Sales API request failed");
      res.status(500).json({ error: "Internal server error" });
    }
  };
}

export interface SalesRouterOptions {
  sessionLimitPerMinute?: number;
  webhookLimitPerMinute?: number;
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown");

async function salesConfig(db: SalesDb) {
  return (await getSettings(db)).config;
}

export function createSalesRouter(db: SalesDb, opts: SalesRouterOptions = {}): IRouter {
  const router: IRouter = Router();

  const sessionLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: opts.sessionLimitPerMinute ?? 600,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const token = sessionToken(req);
      return token ? `session:${hashToken(token)}` : `ip:${ipKey(req)}`;
    },
    handler: (req, res) => {
      logger.warn({ ip: req.ip }, "Rate limit exceeded (sales session)");
      res.status(429).json({ error: "Too many requests. Please slow down." });
    },
  });

  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: opts.webhookLimitPerMinute ?? 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKey(req),
    handler: (req, res) => {
      logger.warn({ ip: req.ip }, "Rate limit exceeded (sales lead webhook)");
      res.status(429).json({ error: "Too many requests" });
    },
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = normalizeLoginEmail(String((req.body as Record<string, unknown> | undefined)?.["email"] ?? ""));
      return `${ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown")}:${email}`;
    },
    handler: (req, res) => {
      logger.warn({ ip: req.ip }, "Rate limit exceeded (sales login)");
      res.status(429).json({ error: "Too many sign-in attempts. Please try again later." });
    },
  });

  const inviteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? "unknown"),
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many requests. Please try again later." });
    },
  });

  const requireSalesUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = sessionToken(req);
      if (!token) {
        res.status(401).json({ error: "Not signed in" });
        return;
      }
      const session = await resolveSession(db, token);
      if (!session) {
        clearSessionCookie(res);
        res.status(401).json({ error: "Session expired or revoked" });
        return;
      }
      if (session.refreshed) setSessionCookie(res, token);
      (req as SalesRequest).salesUser = session.actor;
      (req as SalesRequest).salesSessionId = session.sessionId;
      next();
    } catch (err) {
      logger.error({ err }, "Sales session check failed");
      res.status(500).json({ error: "Internal server error" });
    }
  };

  const requireFounder = (req: Request, res: Response, next: NextFunction): void => {
    if ((req as SalesRequest).salesUser?.role !== "founder") {
      res.status(403).json({ error: "Founder access required" });
      return;
    }
    next();
  };

  router.use("/admin/sales", requireAdmin);
  router.post("/admin/sales/bootstrap", handle(async (req, res) => {
    const body = parse(s.bootstrapSchema, req.body);
    const result = await bootstrapFounderInvite(db, body.email);
    res.status(201).json(result);
  }));

  router.post("/sales/webhooks/leads", webhookLimiter, handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const secret = process.env["SALES_WEBHOOK_SECRET"];
    if (!secret) throw new SalesError(503, "Lead webhook is not configured");
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!verifySignature(rawBody, req.get(SIGNATURE_HEADER), secret)) throw new SalesError(401, "Invalid signature");
    const eventId = req.get(EVENT_ID_HEADER)?.trim();
    if (!eventId || eventId.length > 200) throw new SalesError(400, "X-Event-Id header is required (max 200 characters)");
    const body = parse(s.webhookLeadSchema, req.body);
    if (body.eventId && body.eventId !== eventId) throw new SalesError(400, "eventId in the body does not match X-Event-Id");
    const result = await ingestLeadWebhook(db, eventId, body, req.body, await salesConfig(db));
    res.status(result.status).json(result.body);
  }));

  router.use("/sales", sessionLimiter);

  router.use("/sales", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!SAFE_METHODS.has(req.method) && req.get("x-sales-request") !== "1") {
      res.status(403).json({ error: "Missing X-Sales-Request header" });
      return;
    }
    next();
  });

  router.get("/sales/invites/:token", inviteLimiter, handle(async (req, res) => {
    const invite = await findValidInvite(db, String(req.params["token"]));
    if (!invite) throw new SalesError(404, "Invite is invalid or has expired");
    res.json({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt });
  }));

  router.post("/sales/invites/:token/accept", inviteLimiter, handle(async (req, res) => {
    const body = parse(s.acceptInviteSchema, req.body);
    const { user, token } = await acceptInvite(db, String(req.params["token"]), body, sessionMeta(req));
    setSessionCookie(res, token);
    res.status(201).json({ user });
  }));

  router.post("/sales/auth/login", loginLimiter, handle(async (req, res) => {
    const body = parse(s.loginSchema, req.body);
    const { user, token } = await login(db, body.email, body.password, sessionMeta(req));
    setSessionCookie(res, token);
    res.json({ user });
  }));

  router.post("/sales/auth/logout", handle(async (req, res) => {
    const token = sessionToken(req);
    if (token) await revokeSessionByToken(db, token);
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  router.use("/sales", requireSalesUser);

  router.get("/sales/auth/me", handle(async (req, res) => {
    res.json({ user: actorOf(req) });
  }));

  router.get("/sales/meta", handle(async (_req, res) => {
    res.json({
      stages: ALL_STAGES,
      orderedStages: ORDERED_STAGES,
      sideStages: SIDE_STAGES,
      roles: s.roleSchema.options,
      activityTypes: s.activityTypeSchema.options,
      taskKinds: s.taskKindSchema.options,
    });
  }));

  router.get("/sales/team", handle(async (req, res) => {
    res.json({ users: await listTeam(db, { includeInactive: req.query["includeInactive"] === "1" }) });
  }));

  router.get("/sales/users", requireFounder, handle(async (_req, res) => {
    res.json(await listUsers(db));
  }));

  router.post("/sales/users", requireFounder, handle(async (req, res) => {
    const body = parse(s.inviteUserSchema, req.body);
    res.status(201).json(await inviteUser(db, actorOf(req), body));
  }));

  router.patch("/sales/users/:id", requireFounder, handle(async (req, res) => {
    const body = parse(s.updateUserSchema, req.body);
    res.json({ user: await updateUser(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.delete("/sales/invites/:id", requireFounder, handle(async (req, res) => {
    await revokeInvite(db, actorOf(req), parseId(req.params["id"]));
    res.json({ ok: true });
  }));

  router.get("/sales/settings", handle(async (_req, res) => {
    res.json(await getSettings(db));
  }));

  router.put("/sales/settings", requireFounder, handle(async (req, res) => {
    const body = parse(s.putSettingsSchema, req.body);
    res.json(await putSettings(db, actorOf(req), body.config, body.reason));
  }));

  router.get("/sales/targets", handle(async (req, res) => {
    const q = parse(s.listTargetsQuery, req.query);
    res.json({ targets: await listTargets(db, q) });
  }));

  router.patch("/sales/targets/:id", requireFounder, handle(async (req, res) => {
    const { reason, ...patch } = parse(s.patchTargetSchema, req.body);
    res.json({ target: await updateTarget(db, actorOf(req), parseId(req.params["id"]), patch, reason) });
  }));

  router.post("/sales/targets/generate", requireFounder, handle(async (req, res) => {
    const body = parse(s.generateTargetsSchema, req.body ?? {});
    res.json(await generateTargets(db, actorOf(req), await salesConfig(db), body));
  }));

  router.get("/sales/companies", handle(async (req, res) => {
    const q = parse(s.listCompaniesQuery, req.query);
    res.json(await listCompanies(db, q));
  }));

  router.post("/sales/companies", handle(async (req, res) => {
    const body = parse(s.createCompanySchema, req.body);
    const { config } = await getSettings(db);
    res.status(201).json(await createCompany(db, actorOf(req), body, config));
  }));

  router.get("/sales/companies/:id", handle(async (req, res) => {
    res.json(await getCompanyDetail(db, parseId(req.params["id"]), await salesConfig(db)));
  }));

  router.patch("/sales/companies/:id", handle(async (req, res) => {
    const body = parse(s.updateCompanySchema, req.body);
    const { config } = await getSettings(db);
    res.json({ company: await updateCompany(db, actorOf(req), parseId(req.params["id"]), body, config) });
  }));

  router.post("/sales/companies/:id/owner", handle(async (req, res) => {
    const body = parse(s.assignOwnerSchema, req.body);
    res.json({ company: await assignCompanyOwner(db, actorOf(req), parseId(req.params["id"]), body.ownerId) });
  }));

  router.post("/sales/companies/:id/dedupe-review", handle(async (req, res) => {
    const body = parse(s.dedupeReviewSchema, req.body);
    res.json(await resolveDedupeReview(db, actorOf(req), parseId(req.params["id"]), body));
  }));

  router.post("/sales/companies/:id/contacts", handle(async (req, res) => {
    const body = parse(s.contactInputSchema, req.body);
    res.status(201).json({ contact: await addContact(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.post("/sales/companies/:id/opportunities", handle(async (req, res) => {
    res.status(201).json({ opportunity: await createOpportunity(db, actorOf(req), parseId(req.params["id"])) });
  }));

  router.patch("/sales/contacts/:id", handle(async (req, res) => {
    const body = parse(s.updateContactSchema, req.body);
    res.json({ contact: await updateContact(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.delete("/sales/contacts/:id", handle(async (req, res) => {
    await deleteContact(db, actorOf(req), parseId(req.params["id"]));
    res.json({ ok: true });
  }));

  router.get("/sales/opportunities/:id", handle(async (req, res) => {
    res.json(await getOpportunity(db, parseId(req.params["id"])));
  }));

  router.patch("/sales/opportunities/:id", handle(async (req, res) => {
    const body = parse(s.updateOpportunitySchema, req.body);
    res.json({ opportunity: await updateOpportunity(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.post("/sales/opportunities/:id/stage", handle(async (req, res) => {
    const body = parse(s.stageChangeSchema, req.body);
    res.json(await changeStage(db, actorOf(req), parseId(req.params["id"]), body));
  }));

  router.get("/sales/activities", handle(async (req, res) => {
    const q = parse(s.listActivitiesQuery, req.query);
    const { config } = await getSettings(db);
    res.json({ activities: await listActivities(db, actorOf(req), q, config.timezone) });
  }));

  router.post("/sales/activities", handle(async (req, res) => {
    const body = parse(s.createActivitySchema, req.body);
    res.status(201).json({ activity: await createActivity(db, actorOf(req), body) });
  }));

  router.patch("/sales/activities/:id", handle(async (req, res) => {
    const body = parse(s.updateActivitySchema, req.body);
    res.json({ activity: await updateActivity(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.post("/sales/activities/:id/cancel", handle(async (req, res) => {
    const body = parse(s.cancelSchema, req.body ?? {});
    res.json({ activity: await cancelActivity(db, actorOf(req), parseId(req.params["id"]), body.reason) });
  }));

  router.get("/sales/tasks", handle(async (req, res) => {
    const q = parse(s.listTasksQuery, req.query);
    const { config } = await getSettings(db);
    res.json(await listTasks(db, actorOf(req), q, config.timezone));
  }));

  router.post("/sales/tasks", handle(async (req, res) => {
    const body = parse(s.createTaskSchema, req.body);
    res.status(201).json({ task: await createTask(db, actorOf(req), body) });
  }));

  router.patch("/sales/tasks/:id", handle(async (req, res) => {
    const body = parse(s.updateTaskSchema, req.body);
    res.json({ task: await updateTask(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.post("/sales/tasks/:id/assign", handle(async (req, res) => {
    const body = parse(s.assignTaskSchema, req.body);
    res.json({ task: await assignTask(db, actorOf(req), parseId(req.params["id"]), body.ownerId) });
  }));

  router.post("/sales/tasks/:id/complete", handle(async (req, res) => {
    const body = parse(s.completeTaskSchema, req.body ?? {});
    res.json({ task: await finishTask(db, actorOf(req), parseId(req.params["id"]), "done", body.outcome) });
  }));

  router.post("/sales/tasks/:id/cancel", handle(async (req, res) => {
    const body = parse(s.cancelSchema, req.body ?? {});
    res.json({ task: await finishTask(db, actorOf(req), parseId(req.params["id"]), "cancelled", body.reason) });
  }));

  router.get("/sales/today", handle(async (req, res) => {
    const q = parse(s.todayQuery, req.query);
    res.json(await getToday(db, actorOf(req), q));
  }));

  router.get("/sales/pilots", handle(async (req, res) => {
    const q = parse(s.listByCompanyQuery.extend({ status: z.enum(s.PILOT_STATUSES).optional() }), req.query);
    res.json({ pilots: await listPilots(db, q) });
  }));

  router.post("/sales/pilots", handle(async (req, res) => {
    const body = parse(s.createPilotSchema, req.body);
    res.status(201).json({ pilot: await createPilot(db, actorOf(req), body, await salesConfig(db)) });
  }));

  router.get("/sales/pilots/:id", handle(async (req, res) => {
    res.json(await getPilot(db, parseId(req.params["id"])));
  }));

  router.patch("/sales/pilots/:id", handle(async (req, res) => {
    const body = parse(s.updatePilotSchema, req.body);
    res.json({ pilot: await updatePilot(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.post("/sales/pilots/:id/status", handle(async (req, res) => {
    const body = parse(s.pilotStatusSchema, req.body);
    res.json({ pilot: await changePilotStatus(db, actorOf(req), parseId(req.params["id"]), body, await salesConfig(db)) });
  }));

  router.post("/sales/pilots/:id/extension", requireFounder, handle(async (req, res) => {
    const body = parse(s.pilotExtensionSchema, req.body);
    res.json({ pilot: await extendPilot(db, actorOf(req), parseId(req.params["id"]), body, await salesConfig(db)) });
  }));

  router.post("/sales/pilots/:id/snapshots", handle(async (req, res) => {
    const body = parse(s.snapshotSchema, req.body);
    const result = await addSnapshot(db, actorOf(req), parseId(req.params["id"]), body);
    res.status(result.result === "created" ? 201 : 200).json(result);
  }));

  router.post("/sales/pilots/:id/snapshots/import", handle(async (req, res) => {
    const body = parse(s.snapshotImportSchema, req.body);
    res.json(await importSnapshots(db, actorOf(req), parseId(req.params["id"]), body.filename, body.rows));
  }));

  router.get("/sales/pilots/:id/report", handle(async (req, res) => {
    res.json(await pilotReport(db, parseId(req.params["id"])));
  }));

  router.get("/sales/proposals", handle(async (req, res) => {
    const q = parse(z.object({ companyId: z.coerce.number().int().positive() }), req.query);
    res.json({ proposals: await listProposals(db, q.companyId) });
  }));

  router.post("/sales/proposals", handle(async (req, res) => {
    const body = parse(s.createProposalSchema, req.body);
    res.status(201).json({ proposal: await createProposal(db, actorOf(req), body, await salesConfig(db)) });
  }));

  router.patch("/sales/proposals/:id", handle(async (req, res) => {
    const body = parse(s.updateProposalSchema, req.body);
    res.json({ proposal: await updateProposal(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.post("/sales/proposals/:id/send", handle(async (req, res) => {
    res.json({ proposal: await sendProposal(db, actorOf(req), parseId(req.params["id"])) });
  }));

  router.post("/sales/proposals/:id/accept", handle(async (req, res) => {
    const body = parse(s.acceptProposalSchema, req.body);
    res.json({ proposal: await acceptProposal(db, actorOf(req), parseId(req.params["id"]), body.acceptedBy, body.acceptedAt) });
  }));

  router.post("/sales/proposals/:id/decline", handle(async (req, res) => {
    const body = parse(s.declineProposalSchema, req.body ?? {});
    res.json({ proposal: await declineProposal(db, actorOf(req), parseId(req.params["id"]), body.reason) });
  }));

  router.get("/sales/payments", handle(async (req, res) => {
    const q = parse(s.listPaymentsQuery, req.query);
    res.json({ payments: await listPayments(db, q) });
  }));

  router.post("/sales/payments", handle(async (req, res) => {
    const body = parse(s.recordPaymentSchema, req.body);
    res.status(201).json({ payment: await recordPayment(db, actorOf(req), body) });
  }));

  router.post("/sales/payments/:id/verify", requireFounder, handle(async (req, res) => {
    res.json(await verifyPayment(db, actorOf(req), parseId(req.params["id"]), (await salesConfig(db)).timezone));
  }));

  router.post("/sales/payments/:id/reject", requireFounder, handle(async (req, res) => {
    const body = parse(s.rejectPaymentSchema, req.body);
    res.json(await rejectPayment(db, actorOf(req), parseId(req.params["id"]), body.reason));
  }));

  router.post("/sales/payments/:id/adjustments", requireFounder, handle(async (req, res) => {
    const body = parse(s.paymentAdjustmentSchema, req.body);
    res.status(201).json(await adjustPayment(db, actorOf(req), parseId(req.params["id"]), body));
  }));

  router.get("/sales/subscriptions", handle(async (req, res) => {
    const q = parse(s.listByCompanyQuery, req.query);
    res.json({ subscriptions: await listSubscriptions(db, q) });
  }));

  router.post("/sales/subscriptions", handle(async (req, res) => {
    const body = parse(s.createSubscriptionSchema, req.body);
    res.status(201).json({ subscription: await createSubscription(db, actorOf(req), body, await salesConfig(db)) });
  }));

  router.get("/sales/subscriptions/:id", handle(async (req, res) => {
    res.json(await getSubscription(db, parseId(req.params["id"])));
  }));

  router.patch("/sales/subscriptions/:id", handle(async (req, res) => {
    const body = parse(s.updateSubscriptionSchema, req.body);
    res.json({ subscription: await updateSubscription(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.post("/sales/subscriptions/:id/live", handle(async (req, res) => {
    const body = parse(s.goLiveSchema, req.body ?? {});
    res.json(await goLive(db, actorOf(req), parseId(req.params["id"]), body, await salesConfig(db)));
  }));

  router.post("/sales/subscriptions/:id/pause", handle(async (req, res) => {
    res.json({ subscription: await pauseSubscription(db, actorOf(req), parseId(req.params["id"])) });
  }));

  router.post("/sales/subscriptions/:id/resume", handle(async (req, res) => {
    res.json({ subscription: await resumeSubscription(db, actorOf(req), parseId(req.params["id"])) });
  }));

  router.post("/sales/subscriptions/:id/cancel", handle(async (req, res) => {
    const body = parse(s.cancelSubscriptionSchema, req.body);
    res.json({ subscription: await cancelSubscription(db, actorOf(req), parseId(req.params["id"]), body.reason) });
  }));

  router.post("/sales/imports/leads/preview", handle(async (req, res) => {
    const body = parse(s.leadImportSchema, req.body);
    res.json(await previewLeadImport(db, body.rows, await salesConfig(db), body.decisions));
  }));

  router.post("/sales/imports/leads/commit", handle(async (req, res) => {
    const body = parse(s.leadImportSchema, req.body);
    res.status(201).json(await commitLeadImport(db, actorOf(req), body.filename, body.rows, await salesConfig(db), body.decisions));
  }));

  router.get("/sales/calendar", handle(async (req, res) => {
    const q = parse(s.calendarQuery, req.query);
    res.json(await getCalendar(db, actorOf(req), q, (await salesConfig(db)).timezone));
  }));

  router.get("/sales/reports", handle(async (req, res) => {
    const q = parse(s.reportsQuery, req.query);
    res.json(await getReports(db, q, await salesConfig(db)));
  }));

  router.get("/sales/expenses", handle(async (req, res) => {
    const q = parse(s.listExpensesQuery, req.query);
    res.json(await listExpenses(db, q));
  }));

  router.post("/sales/expenses", requireFounder, handle(async (req, res) => {
    const body = parse(s.createExpenseSchema, req.body);
    res.status(201).json({ expense: await createExpense(db, actorOf(req), body) });
  }));

  router.patch("/sales/expenses/:id", requireFounder, handle(async (req, res) => {
    const body = parse(s.updateExpenseSchema, req.body);
    res.json({ expense: await updateExpense(db, actorOf(req), parseId(req.params["id"]), body) });
  }));

  router.delete("/sales/expenses/:id", requireFounder, handle(async (req, res) => {
    await deleteExpense(db, actorOf(req), parseId(req.params["id"]));
    res.json({ ok: true });
  }));

  router.get("/sales/exports/:file", handle(async (req, res) => {
    const match = /^([a-z]+)\.csv$/.exec(String(req.params["file"]));
    const kind = match?.[1];
    if (!kind || !(EXPORT_KINDS as readonly string[]).includes(kind)) throw new SalesError(404, "Unknown export");
    const q = parse(s.exportQuery, req.query);
    const csv = await exportCsv(db, kind as ExportKind, q, (await salesConfig(db)).timezone);
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="sales-${kind}${q.demo ? "-demo" : ""}.csv"`);
    res.send(csv);
  }));

  router.get("/sales/demo", requireFounder, handle(async (_req, res) => {
    res.json(await demoStatus(db));
  }));

  router.post("/sales/demo/seed", requireFounder, handle(async (req, res) => {
    const result = await seedDemo(db, actorOf(req), await salesConfig(db));
    res.status(result.seeded ? 201 : 200).json(result);
  }));

  router.delete("/sales/demo", requireFounder, handle(async (req, res) => {
    res.json({ removed: await clearDemo(db, actorOf(req)) });
  }));

  return router;
}
