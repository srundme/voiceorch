import express from "express";
import cookieParser from "cookie-parser";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  salesAuditTable,
  salesCompaniesTable,
  salesImportsTable,
  salesPilotSnapshotsTable,
  salesSubscriptionsTable,
  salesTasksTable,
} from "@workspace/db/schema";
import { getSettings } from "./settings-service.js";
import { getReports } from "./report-service.js";
import { generateLiveTasks } from "./revenue-core.js";
import { createSalesRouter, type SalesRouterOptions } from "./router.js";
import { tryCreateSalesTestDb } from "./test-db.js";
import { addMonths, localDateString } from "./time.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ADMIN_TOKEN = "sales-workflow-admin-token";
const WEBHOOK_SECRET = "sales-workflow-webhook-secret";
const DAY = 86_400_000;
const testDb = await tryCreateSalesTestDb();

interface CallResult {
  status: number;
  body: any;
  text: string;
  headers: Headers;
  cookie: string | null;
}

interface Session {
  cookie: string;
  user: { id: number; email: string; role: string };
}

const istDate = (offsetDays = 0) => localDateString(new Date(Date.now() + offsetDays * DAY));
const isoIn = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function hasNaN(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNaN);
  if (value && typeof value === "object" && !(value instanceof Date)) return Object.values(value).some(hasNaN);
  return false;
}

describe.skipIf(!testDb)(`sales workflows over HTTP (${testDb?.driver ?? "no db"})`, () => {
  const db = testDb!.db;
  let server: Server;
  let origin = "";
  const previousAdminToken = process.env["ADMIN_TOKEN"];
  const previousSecret = process.env["SALES_WEBHOOK_SECRET"];

  async function startServer(opts: SalesRouterOptions = {}) {
    if (server) await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => { req.rawBody = buf; } }));
    app.use("/api", createSalesRouter(db, opts));
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
        origin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  }

  beforeEach(async () => {
    process.env["ADMIN_TOKEN"] = ADMIN_TOKEN;
    process.env["SALES_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
    await testDb!.reset();
    await startServer();
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    server = undefined as unknown as Server;
  });

  afterAll(async () => {
    for (const [key, prev] of [["ADMIN_TOKEN", previousAdminToken], ["SALES_WEBHOOK_SECRET", previousSecret]] as const) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
    await testDb?.close();
  });

  async function call(
    method: string,
    path: string,
    opts: { body?: unknown; raw?: string; cookie?: string | null; csrf?: boolean; admin?: boolean; headers?: Record<string, string> } = {},
  ): Promise<CallResult> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined || opts.raw !== undefined) headers["content-type"] = "application/json";
    if (opts.cookie) headers["cookie"] = opts.cookie;
    if (opts.csrf !== false && method !== "GET") headers["x-sales-request"] = "1";
    if (opts.admin) headers["x-admin-token"] = ADMIN_TOKEN;
    const res = await fetch(`${origin}/api${path}`, {
      method,
      headers,
      body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
    const token = res.headers.get("set-cookie")?.match(/ss_sales=([^;]+)/)?.[1];
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body, text, headers: res.headers, cookie: token ? `ss_sales=${token}` : null };
  }

  async function bootstrapFounder(): Promise<Session> {
    const boot = await call("POST", "/admin/sales/bootstrap", { admin: true, body: { email: "founder@snapserve.ai" } });
    expect(boot.status).toBe(201);
    const accepted = await call("POST", `/sales/invites/${boot.body.token}/accept`, { body: { name: "Founder", password: "founder-pass-123" } });
    expect(accepted.status).toBe(201);
    return { cookie: accepted.cookie!, user: accepted.body.user };
  }

  async function addTeammate(founder: Session, email = "mate@snapserve.ai"): Promise<Session> {
    const invite = await call("POST", "/sales/users", { cookie: founder.cookie, body: { email, role: "teammate" } });
    expect(invite.status).toBe(201);
    const accepted = await call("POST", `/sales/invites/${invite.body.token}/accept`, { body: { name: "Mate", password: "teammate-pass-1" } });
    expect(accepted.status).toBe(201);
    return { cookie: accepted.cookie!, user: accepted.body.user };
  }

  const qualifiedFields = { painPoint: "Missed calls", callingVolume: 2000, budgetFit: "yes", decisionMaker: "Owner" };

  async function createCompany(session: Session, body: Record<string, unknown>) {
    const res = await call("POST", "/sales/companies", { cookie: session.cookie, body });
    expect(res.status).toBe(201);
    return res.body as { company: { id: number }; opportunity: { id: number }; contacts: Array<{ id: number }> };
  }

  async function stage(session: Session, oppId: number, body: Record<string, unknown>) {
    return call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: session.cookie, body });
  }

  async function setConfig(founder: Session, patch: (config: any) => any) {
    const current = (await call("GET", "/sales/settings", { cookie: founder.cookie })).body.config;
    const res = await call("PUT", "/sales/settings", { cookie: founder.cookie, body: { config: patch(current) } });
    expect(res.status).toBe(200);
  }

  const setupFields = () => ({
    useCase: "Lead callback",
    language: "English",
    qualificationCriteria: "Budget > 1L",
    approvedScript: "Hello…",
    leadCount: 200,
    contactBasisConfirmed: true,
    reviewAt: isoIn(3),
  });

  async function createPilot(session: Session, companyId: number, extra: Record<string, unknown> = {}) {
    const res = await call("POST", "/sales/pilots", { cookie: session.cookie, body: { companyId, ...setupFields(), ...extra } });
    expect(res.status).toBe(201);
    return res.body.pilot as { id: number };
  }

  async function pilotStatus(session: Session, pilotId: number, body: Record<string, unknown>) {
    return call("POST", `/sales/pilots/${pilotId}/status`, { cookie: session.cookie, body });
  }

  async function acceptedProposal(session: Session, companyId: number, monthlyFeePaise = 2_500_000) {
    const created = await call("POST", "/sales/proposals", { cookie: session.cookie, body: { companyId, monthlyFeePaise } });
    expect(created.status).toBe(201);
    const accepted = await call("POST", `/sales/proposals/${created.body.proposal.id}/accept`, { cookie: session.cookie, body: { acceptedBy: "Buyer" } });
    expect(accepted.status).toBe(200);
    return accepted.body.proposal as { id: number };
  }

  async function payment(session: Session, body: Record<string, unknown>) {
    const res = await call("POST", "/sales/payments", { cookie: session.cookie, body });
    expect(res.status).toBe(201);
    return res.body.payment as { id: number };
  }

  async function verify(session: Session, paymentId: number) {
    return call("POST", `/sales/payments/${paymentId}/verify`, { cookie: session.cookie });
  }

  async function reports(session: Session, query = "") {
    const res = await call("GET", `/sales/reports?from=${istDate(-30)}&to=${istDate(0)}${query}`, { cookie: session.cookie });
    expect(res.status).toBe(200);
    return res.body;
  }

  async function companyCount(session: Session) {
    return (await call("GET", "/sales/companies?pageSize=1", { cookie: session.cookie })).body.total as number;
  }

  function signedWebhook(payload: unknown, eventId: string, opts: { secret?: string; headers?: Record<string, string> } = {}) {
    const raw = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", opts.secret ?? WEBHOOK_SECRET).update(raw).digest("hex")}`;
    return call("POST", "/sales/webhooks/leads", {
      raw,
      csrf: false,
      headers: { "x-snapserve-signature": signature, "x-event-id": eventId, ...opts.headers },
    });
  }

  describe("W1 company → assign → visit → demo → re-fetch", () => {
    it("persists every step across fresh requests", async () => {
      const founder = await bootstrapFounder();
      const mate = await addTeammate(founder);
      const created = await createCompany(founder, { name: "Persist Co", ownerId: null, contacts: [{ name: "Buyer", phone: "98450 11111" }] });
      const id = created.company.id;

      const assigned = await call("POST", `/sales/companies/${id}/owner`, { cookie: founder.cookie, body: { ownerId: mate.user.id } });
      expect(assigned.status).toBe(200);
      const visit = await call("POST", "/sales/activities", { cookie: mate.cookie, body: { companyId: id, type: "visit", flags: { buyerConversation: true } } });
      expect(visit.status).toBe(201);
      const demoAt = isoIn(2);
      const demo = await call("POST", "/sales/activities", {
        cookie: mate.cookie,
        body: { companyId: id, type: "demo", status: "scheduled", scheduledAt: demoAt, contactId: created.contacts[0]!.id },
      });
      expect(demo.status).toBe(201);

      const detail = (await call("GET", `/sales/companies/${id}`, { cookie: founder.cookie })).body;
      expect(detail.company.ownerId).toBe(mate.user.id);
      expect(detail.owner).toMatchObject({ id: mate.user.id });
      expect(detail.company.lastActivityAt).not.toBeNull();
      expect(detail.activities.map((a: { type: string; status: string }) => `${a.type}:${a.status}`).sort()).toEqual(["demo:scheduled", "visit:completed"]);
      expect(detail.activities.find((a: { type: string }) => a.type === "visit").flagFirstVisit).toBe(true);
      expect(detail.tasks.some((t: { dueAt: string; status: string }) => t.dueAt === demoAt && t.status === "open")).toBe(true);
      expect(detail).toHaveProperty("pilots");
      expect(detail).toHaveProperty("payments");
      expect(detail.notes).toEqual({ internal: null, customerFacing: null });
    });
  });

  describe("W2 qualify → demo → pilot → results → proposal", () => {
    it("walks every stage with real evidence and no bypass", async () => {
      const founder = await bootstrapFounder();
      const created = await createCompany(founder, { name: "Journey Co", ...qualifiedFields, contacts: [{ name: "Buyer", email: "buyer@journey.co" }] });
      const companyId = created.company.id;
      const oppId = created.opportunity.id;
      const contactId = created.contacts[0]!.id;

      expect((await stage(founder, oppId, { to: "Qualified" })).status).toBe(200);
      const demo = await call("POST", "/sales/activities", { cookie: founder.cookie, body: { companyId, type: "demo", status: "scheduled", scheduledAt: isoIn(1), contactId } });
      expect((await stage(founder, oppId, { to: "Demo booked" })).status).toBe(200);
      expect((await call("PATCH", `/sales/activities/${demo.body.activity.id}`, { cookie: founder.cookie, body: { status: "completed", occurredAt: new Date().toISOString() } })).status).toBe(200);
      expect((await stage(founder, oppId, { to: "Demo completed" })).status).toBe(200);

      const readiness = { dataReady: true, scriptReady: true, callingReadinessConfirmed: true, reviewAt: isoIn(4) };
      expect((await call("PATCH", `/sales/opportunities/${oppId}`, { cookie: founder.cookie, body: { pilotReadiness: readiness } })).status).toBe(200);
      expect((await stage(founder, oppId, { to: "Pilot ready" })).status).toBe(200);

      expect((await stage(founder, oppId, { to: "Pilot running" })).status).toBe(400);
      const pilot = await createPilot(founder, companyId);
      const setup = await pilotStatus(founder, pilot.id, { to: "Setup" });
      expect(setup.status).toBe(200);
      expect(setup.body.pilot.onboardingStartedAt).not.toBeNull();
      expect((await stage(founder, oppId, { to: "Pilot running" })).status).toBe(200);
      const calling = await pilotStatus(founder, pilot.id, { to: "Calling" });
      expect(calling.body.pilot.campaignStartedAt).not.toBeNull();

      const snap = await call("POST", `/sales/pilots/${pilot.id}/snapshots`, {
        cookie: founder.cookie,
        body: { asOf: new Date().toISOString(), attempts: 150, distinctRecords: 120, answered: 80, meaningful: 40, qualifiedPeople: 15, acceptedOutcomes: 9, callbackRequests: 6, confirmedAppointments: 4, costPaise: 90_000 },
      });
      expect(snap.status).toBe(201);
      expect(snap.body.pilot.rates.answerRate).toMatchObject({ numerator: 80, denominator: 150 });

      expect((await stage(founder, oppId, { to: "Results reviewed" })).status).toBe(400);
      const reviewed = await stage(founder, oppId, {
        to: "Results reviewed",
        evidence: { review: { buyerFeedback: "Liked it", acceptedOutcomes: "9 accepted", nextDecision: "Send proposal" } },
      });
      expect(reviewed.status).toBe(200);

      expect((await stage(founder, oppId, { to: "Proposal" })).status).toBe(400);
      const proposal = await acceptedProposal(founder, companyId);
      const moved = await stage(founder, oppId, { to: "Proposal" });
      expect(moved.status).toBe(200);
      expect(moved.body.bypass).toBe(false);

      const detail = (await call("GET", `/sales/companies/${companyId}`, { cookie: founder.cookie })).body;
      expect(detail.opportunity.stage).toBe("Proposal");
      expect(detail.pilots[0].latestSnapshot.attempts).toBe(150);
      expect(detail.proposals[0]).toMatchObject({ id: proposal.id, status: "accepted", termsAcceptedBy: "Buyer" });
      expect(detail.proposals[0].amounts).toMatchObject({ monthlyFeePaise: 2_500_000, monthlyTaxPaise: 450_000 });
    });
  });

  describe("W3 payment → verify → Paid → subscription → Live → tasks", () => {
    it("only founders verify, Paid creates a subscription, Live generates tasks exactly once", async () => {
      const founder = await bootstrapFounder();
      const mate = await addTeammate(founder);
      const created = await createCompany(founder, { name: "Paying Co", ...qualifiedFields });
      const companyId = created.company.id;
      const oppId = created.opportunity.id;
      expect((await stage(founder, oppId, { to: "Qualified" })).status).toBe(200);
      await acceptedProposal(founder, companyId);
      expect((await stage(founder, oppId, { to: "Proposal", bypassReason: "Referral wants pricing" })).status).toBe(200);

      const paidAt = isoIn(-1);
      const p = await payment(founder, { companyId, kind: "first_month", feePaise: 2_500_000, taxPaise: 450_000, receivedAt: paidAt, reference: "UTR1" });
      expect((await stage(founder, oppId, { to: "Paid" })).status).toBe(400);
      expect((await verify(mate, p.id)).status).toBe(403);
      const verified = await verify(founder, p.id);
      expect(verified.status).toBe(200);
      expect(verified.body.firstPaidAt).toBe(paidAt);

      expect((await stage(founder, oppId, { to: "Paid" })).status).toBe(200);
      const subs = (await call("GET", `/sales/subscriptions?companyId=${companyId}`, { cookie: founder.cookie })).body.subscriptions;
      expect(subs).toHaveLength(1);
      expect(subs[0]).toMatchObject({ status: "active", monthlyFeePaise: 2_500_000 });
      const subId = subs[0].id;

      const notReady = await call("POST", `/sales/subscriptions/${subId}/live`, { cookie: founder.cookie, body: { startDate: istDate(0) } });
      expect(notReady.status).toBe(400);
      expect(notReady.body.errors.join(" ")).toContain("onboarding");
      await call("PATCH", `/sales/subscriptions/${subId}`, { cookie: founder.cookie, body: { onboardingChecks: { numberConnected: true, scriptLive: true } } });
      const live = await call("POST", `/sales/subscriptions/${subId}/live`, { cookie: founder.cookie, body: { startDate: istDate(0) } });
      expect(live.status).toBe(200);
      expect(live.body.opportunityStage).toBe("Live");
      expect(live.body.subscription.renewalDate).not.toBeNull();
      const keys = live.body.tasks.map((t: { dedupeKey: string }) => t.dedupeKey).sort();
      expect(keys).toEqual(
        [`sub:${subId}:renewal:${live.body.subscription.renewalDate}`, `sub:${subId}:review:d1`, `sub:${subId}:review:d14`, `sub:${subId}:review:d25`, `sub:${subId}:review:d7`].sort(),
      );

      const [sub] = await db.select().from(salesSubscriptionsTable).where(eq(salesSubscriptionsTable.id, subId));
      expect(await generateLiveTasks(db, { id: founder.user.id, email: founder.user.email, name: "Founder", role: "founder" }, sub!, "Asia/Kolkata")).toBe(0);
      expect(await db.select().from(salesTasksTable).where(eq(salesTasksTable.subscriptionId, subId))).toHaveLength(5);
      expect((await call("POST", `/sales/subscriptions/${subId}/live`, { cookie: founder.cookie, body: {} })).status).toBe(400);
    });
  });

  describe("W4 renewals, cancellation, partial payments and refunds", () => {
    it("counts a company as newly paid only once the cumulative verified fee reaches the threshold", async () => {
      const founder = await bootstrapFounder();
      const { company } = await createCompany(founder, { name: "Partial Co" });
      await acceptedProposal(founder, company.id, 2_500_000);

      const first = await payment(founder, { companyId: company.id, kind: "first_month", feePaise: 1_000_000, taxPaise: 180_000, receivedAt: isoIn(-5) });
      expect((await verify(founder, first.id)).body.firstPaidAt).toBeNull();
      expect((await reports(founder)).newPaidClients.count).toBe(0);

      const secondAt = isoIn(-3);
      const second = await payment(founder, { companyId: company.id, kind: "first_month", feePaise: 1_500_000, taxPaise: 270_000, receivedAt: secondAt });
      expect((await verify(founder, second.id)).body.firstPaidAt).toBe(secondAt);
      expect((await reports(founder)).newPaidClients.count).toBe(1);

      const refund = await call("POST", `/sales/payments/${second.id}/adjustments`, {
        cookie: founder.cookie,
        body: { kind: "refund", feeDeltaPaise: -500_000, taxDeltaPaise: -90_000, reason: "Partial refund" },
      });
      expect(refund.status).toBe(201);
      expect(refund.body.firstPaidAt).toBeNull();
      expect(refund.body.payment).toMatchObject({ netFeePaise: 1_000_000, refundedPaise: 590_000 });
      expect((await reports(founder)).newPaidClients.count).toBe(0);
      const audit = await db.select().from(salesAuditTable).where(and(eq(salesAuditTable.entity, "sales_company"), eq(salesAuditTable.action, "first_paid_recomputed")));
      expect(audit.length).toBeGreaterThanOrEqual(2);
    });

    it("renewals never change the new-paid count; cancelling drops active MRR", async () => {
      const founder = await bootstrapFounder();
      const created = await createCompany(founder, { name: "Renewing Co", ...qualifiedFields });
      const companyId = created.company.id;
      const oppId = created.opportunity.id;
      await stage(founder, oppId, { to: "Qualified" });
      await acceptedProposal(founder, companyId);
      await stage(founder, oppId, { to: "Proposal", bypassReason: "Fast track" });
      const firstPaidAt = isoIn(-10);
      const p = await payment(founder, { companyId, kind: "first_month", feePaise: 2_500_000, taxPaise: 450_000, receivedAt: firstPaidAt });
      await verify(founder, p.id);
      expect((await stage(founder, oppId, { to: "Paid" })).status).toBe(200);
      const created0 = (await call("GET", `/sales/subscriptions?companyId=${companyId}`, { cookie: founder.cookie })).body.subscriptions[0];
      const sub = (await call("PATCH", `/sales/subscriptions/${created0.id}`, { cookie: founder.cookie, body: { startDate: istDate(-9) } })).body.subscription;
      expect(sub.renewalDate).toBe(addMonths(istDate(-9), 1));

      const before = await reports(founder);
      expect(before.newPaidClients.count).toBe(1);
      expect(before.mrr).toMatchObject({ activeMrrPaise: 2_500_000, activeSubscriptions: 1 });
      expect(before.mrr.mrrRule).toContain("active");

      const renewal = await payment(founder, { companyId, kind: "renewal", feePaise: 2_500_000, taxPaise: 450_000, receivedAt: isoIn(-1) });
      const verified = await verify(founder, renewal.id);
      expect(verified.status).toBe(200);
      expect(verified.body.renewalDate).toBe(addMonths(sub.renewalDate, 1));
      expect(verified.body.firstPaidAt).toBe(firstPaidAt);
      const afterRenewal = await reports(founder);
      expect(afterRenewal.newPaidClients.count).toBe(1);
      expect(afterRenewal.cash.byKind.renewal.feePaise).toBe(2_500_000);
      const [company] = await db.select().from(salesCompaniesTable).where(eq(salesCompaniesTable.id, companyId));
      expect(company!.firstPaidAt?.toISOString()).toBe(firstPaidAt);

      expect((await call("POST", `/sales/subscriptions/${sub.id}/cancel`, { cookie: founder.cookie, body: {} })).status).toBe(400);
      expect((await call("POST", `/sales/subscriptions/${sub.id}/cancel`, { cookie: founder.cookie, body: { reason: "Closed business" } })).status).toBe(200);
      const afterCancel = await reports(founder);
      expect(afterCancel.mrr).toMatchObject({ activeMrrPaise: 0, activeSubscriptions: 0 });
      expect((await call("GET", "/sales/today", { cookie: founder.cookie })).body.revenue.activeMrrPaise).toBe(0);
    });
  });

  describe("W5 idempotent imports and webhooks", () => {
    const rows = [
      { name: "Alpha Staffing", phone: "98450 22222", city: "Bengaluru", source: "website_form", contactName: "Arun" },
      { name: "Beta Loans", email: "owner@betaloans.in", sector: "Loan DSA", source: "referral" },
      { name: "Gamma Realty", website: "https://gammarealty.in" },
      { name: "", phone: "98450 33333" },
      { name: "No Contact Pvt Ltd" },
    ];

    it("importing the same leads CSV twice creates nothing the second time", async () => {
      const founder = await bootstrapFounder();
      const preview = await call("POST", "/sales/imports/leads/preview", { cookie: founder.cookie, body: { filename: "leads.csv", rows } });
      expect(preview.status).toBe(200);
      expect(preview.body.counts).toEqual({ create: 3, update: 0, skip: 0, review: 0, reject: 2 });
      expect(await companyCount(founder)).toBe(0);

      const first = await call("POST", "/sales/imports/leads/commit", { cookie: founder.cookie, body: { filename: "leads.csv", rows } });
      expect(first.status).toBe(201);
      expect(first.body.counts.create).toBe(3);
      const reportsBefore = await reports(founder);
      expect(await companyCount(founder)).toBe(3);

      const second = await call("POST", "/sales/imports/leads/commit", { cookie: founder.cookie, body: { filename: "leads.csv", rows } });
      expect(second.body.counts).toEqual({ create: 0, update: 0, skip: 3, review: 0, reject: 2 });
      expect(await companyCount(founder)).toBe(3);
      expect((await reports(founder)).activity).toEqual(reportsBefore.activity);
      expect(await db.select().from(salesImportsTable)).toHaveLength(2);

      const similar = await call("POST", "/sales/imports/leads/preview", {
        cookie: founder.cookie,
        body: { filename: "more.csv", rows: [{ name: "Alpha Staffing Bengaluru", phone: "98450 44444" }, { name: "Beta Loans", email: "new@betaloans.in", city: "Mysuru" }] },
      });
      expect(similar.body.rows[0]).toMatchObject({ decision: "review", matchedOn: "name" });
      expect(similar.body.rows[1]).toMatchObject({ decision: "update", matchedOn: "domain" });
    });

    it("dedupes webhook deliveries by event id and rejects bad signatures or missing secret", async () => {
      const founder = await bootstrapFounder();
      const payload = {
        source: "website_form",
        campaign: "Diwali",
        enquiredAt: new Date().toISOString(),
        company: { name: "Webhook Lead Co", website: "webhooklead.in", city: "Chennai" },
        contact: { name: "Priya", phone: "+91 98450 55555", email: "priya@webhooklead.in" },
        consent: { text: "I agree to be contacted", capturedAt: new Date().toISOString(), method: "website_checkbox" },
      };
      const first = await signedWebhook(payload, "evt-1");
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ duplicate: false, created: true });
      const again = await signedWebhook(payload, "evt-1");
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ duplicate: true, eventId: "evt-1", companyId: first.body.companyId });
      expect(await companyCount(founder)).toBe(1);

      const detail = (await call("GET", `/sales/companies/${first.body.companyId}`, { cookie: founder.cookie })).body;
      expect(detail.company).toMatchObject({ isInbound: true, originalSource: "website_form", sourceCampaign: "Diwali", ownerId: founder.user.id, createdBy: null });
      expect(detail.company.contactPermissionEvidence).toContain("website_checkbox");
      expect(detail.tasks.find((t: { dedupeKey: string }) => t.dedupeKey === `company:${first.body.companyId}:first_response`)).toBeTruthy();
      expect(detail.firstResponse).toMatchObject({ respondedAt: null, targetMinutes: 15 });

      const repeat = await signedWebhook({ ...payload, campaign: "Pongal" }, "evt-2");
      expect(repeat.body).toMatchObject({ duplicate: false, created: false, companyId: first.body.companyId });
      expect(await companyCount(founder)).toBe(1);

      expect((await signedWebhook(payload, "evt-3", { secret: "wrong-secret" })).status).toBe(401);
      expect((await call("POST", "/sales/webhooks/leads", { raw: JSON.stringify(payload), csrf: false, headers: { "x-event-id": "evt-4" } })).status).toBe(401);
      expect((await signedWebhook(payload, "")).status).toBe(400);
      expect((await signedWebhook({ ...payload, source: "tv_ad" }, "evt-5")).status).toBe(400);
      expect((await signedWebhook({ ...payload, source: "tv_ad" }, "evt-5")).status).toBe(400);
      delete process.env["SALES_WEBHOOK_SECRET"];
      expect((await signedWebhook(payload, "evt-6")).status).toBe(503);
    });

    it("rate limits the webhook per IP and authed routes per session", async () => {
      await startServer({ webhookLimitPerMinute: 2, sessionLimitPerMinute: 4 });
      const founder = await bootstrapFounder();
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await signedWebhook({}, `rl-${i}`)).status);
      expect(statuses).toEqual([400, 400, 429]);
      const authed = [];
      for (let i = 0; i < 5; i++) authed.push((await call("GET", "/sales/auth/me", { cookie: founder.cookie })).status);
      expect(authed).toEqual([200, 200, 200, 200, 429]);
      expect((await call("GET", "/sales/auth/me")).status).toBe(401);
    });
  });

  describe("W6 teammate permissions and demo isolation", () => {
    it("blocks founder-only actions for teammates over HTTP", async () => {
      const founder = await bootstrapFounder();
      const mate = await addTeammate(founder);
      await setConfig(founder, (c) => ({ ...c, pilot: { ...c.pilot, activeCapacity: 1 } }));

      const { company, opportunity } = await createCompany(mate, { name: "Mate Pilot Co", ...qualifiedFields });
      const p = await payment(mate, { companyId: company.id, kind: "first_month", feePaise: 1_000, receivedAt: isoIn(-1) });
      expect((await verify(mate, p.id)).status).toBe(403);
      expect((await call("POST", `/sales/payments/${p.id}/reject`, { cookie: mate.cookie, body: { reason: "x" } })).status).toBe(403);
      expect((await call("POST", `/sales/payments/${p.id}/adjustments`, { cookie: mate.cookie, body: { kind: "correction", feeDeltaPaise: 5, reason: "x" } })).status).toBe(403);

      const { company: other } = await createCompany(founder, { name: "Founder Pilot Co" });
      const blocker = await createPilot(founder, other.id);
      expect((await pilotStatus(founder, blocker.id, { to: "Setup" })).status).toBe(200);
      const matePilot = await createPilot(mate, company.id);
      const capacity = await pilotStatus(mate, matePilot.id, { to: "Setup", overrideReason: "Please" });
      expect(capacity.status).toBe(409);
      expect(capacity.body.code).toBe("capacity");
      expect((await call("POST", `/sales/pilots/${blocker.id}/extension`, { cookie: mate.cookie, body: { attempts: 150, reason: "x", costLimitPaise: 1, reviewAt: isoIn(2) } })).status).toBe(403);

      expect((await stage(mate, opportunity.id, { to: "Qualified" })).status).toBe(200);
      expect((await stage(mate, opportunity.id, { to: "Proposal", bypassReason: "Hot" })).status).toBe(403);
      const config = (await call("GET", "/sales/settings", { cookie: mate.cookie })).body.config;
      expect((await call("PUT", "/sales/settings", { cookie: mate.cookie, body: { config } })).status).toBe(403);
      expect((await call("POST", "/sales/users", { cookie: mate.cookie, body: { email: "x@y.co", role: "teammate" } })).status).toBe(403);
      expect((await call("PATCH", `/sales/users/${founder.user.id}`, { cookie: mate.cookie, body: { status: "deactivated" } })).status).toBe(403);

      const expense = await call("POST", "/sales/expenses", { cookie: founder.cookie, body: { date: istDate(0), category: "ads", amountPaise: 1000 } });
      expect(expense.status).toBe(201);
      expect((await call("POST", "/sales/expenses", { cookie: mate.cookie, body: { date: istDate(0), category: "ads", amountPaise: 1000 } })).status).toBe(403);
      expect((await call("DELETE", `/sales/expenses/${expense.body.expense.id}`, { cookie: mate.cookie })).status).toBe(403);
      expect((await call("GET", "/sales/expenses", { cookie: mate.cookie })).body.items).toHaveLength(1);
      expect((await call("POST", "/sales/demo/seed", { cookie: mate.cookie })).status).toBe(403);
      expect((await call("DELETE", "/sales/demo", { cookie: mate.cookie })).status).toBe(403);
    });

    it("demo seed never touches actual totals; demo=1 shows them; delete removes only demo rows", async () => {
      const founder = await bootstrapFounder();
      await createCompany(founder, { name: "Real Co" });
      const todayBefore = (await call("GET", "/sales/today", { cookie: founder.cookie })).body;
      const reportsBefore = await reports(founder);

      const seeded = await call("POST", "/sales/demo/seed", { cookie: founder.cookie });
      expect(seeded.status).toBe(201);
      expect((await call("POST", "/sales/demo/seed", { cookie: founder.cookie })).body.seeded).toBe(false);

      const todayAfter = (await call("GET", "/sales/today", { cookie: founder.cookie })).body;
      expect(todayAfter.revenue).toEqual(todayBefore.revenue);
      expect(todayAfter.activity.actual).toEqual(todayBefore.activity.actual);
      const reportsAfter = await reports(founder);
      for (const key of ["activity", "cash", "mrr", "newPaidClients", "pilotCosts", "acquisitionCost"]) {
        expect(reportsAfter[key]).toEqual(reportsBefore[key]);
      }
      expect(await companyCount(founder)).toBe(1);

      const demoReports = await reports(founder, "&demo=1");
      expect(demoReports.activity.totals).toMatchObject({ visits: 3, demos: 3, pilotsStarted: 1, newPaid: 1 });
      expect(demoReports.mrr.activeMrrPaise).toBe(2_500_000);
      expect((await call("GET", "/sales/today?demo=1", { cookie: founder.cookie })).body.revenue.activeMrrPaise).toBe(2_500_000);
      const demoCompanies = (await call("GET", "/sales/companies?demo=1", { cookie: founder.cookie })).body.items;
      expect(demoCompanies).toHaveLength(3);
      expect(demoCompanies.every((c: { name: string }) => c.name.startsWith("Demo — ") && c.name.endsWith("(fictional)"))).toBe(true);

      const cleared = await call("DELETE", "/sales/demo", { cookie: founder.cookie });
      expect(cleared.body.removed.companies).toBe(3);
      expect(await companyCount(founder)).toBe(1);
      expect((await call("GET", "/sales/companies?demo=1", { cookie: founder.cookie })).body.total).toBe(0);
    });
  });

  describe("W7 zero data, date filters and overdue tasks", () => {
    it("returns zeros and nulls (never NaN) on an empty database", async () => {
      const founder = await bootstrapFounder();
      const r = await reports(founder, "&groupBy=city");
      expect(r.activity.totals).toEqual({ visits: 0, firstVisits: 0, conversations: 0, demos: 0, pilotsStarted: 0, newPaid: 0 });
      expect(r.activity.groups).toEqual([]);
      expect(r.funnel.steps.slice(1).every((s: { fromPrevious: { value: unknown } }) => s.fromPrevious.value === null)).toBe(true);
      expect(r.pilotCosts).toMatchObject({ totalPaise: 0, perPilotPaise: null });
      expect(r.cash).toMatchObject({ feePaise: 0, taxPaise: 0, totalPaise: 0 });
      expect(r.mrr).toMatchObject({ activeMrrPaise: 0, overdueMrrPaise: 0 });
      expect(r.acquisitionCost.bySource.every((s: { costPerNewPaidPaise: unknown }) => s.costPerNewPaidPaise === null)).toBe(true);
      expect(r.pilotCohorts.cohorts).toEqual([]);
      expect(r.forecast.assumptions.length).toBeGreaterThan(0);

      const { config } = await getSettings(db);
      expect(hasNaN(await getReports(db, { from: istDate(-30), to: istDate(0), cohort: "month", demo: false }, config))).toBe(false);
      const today = await call("GET", "/sales/today", { cookie: founder.cookie });
      expect(today.status).toBe(200);
      expect(today.text).not.toMatch(/NaN|Infinity/);
      expect(today.body.revenue).toMatchObject({ activeMrrPaise: 0, overdueSubscriptions: 0 });
      const cal = await call("GET", `/sales/calendar?from=${istDate(0)}&to=${istDate(7)}`, { cookie: founder.cookie });
      expect(cal.status).toBe(200);
    });

    it("respects date filters and lists overdue tasks", async () => {
      const founder = await bootstrapFounder();
      const { company } = await createCompany(founder, { name: "Dated Co" });
      const inside = await payment(founder, { companyId: company.id, kind: "setup", feePaise: 100_000, taxPaise: 18_000, receivedAt: isoIn(-2) });
      const outside = await payment(founder, { companyId: company.id, kind: "setup", feePaise: 900_000, taxPaise: 162_000, receivedAt: isoIn(-60) });
      await verify(founder, inside.id);
      await verify(founder, outside.id);
      expect((await reports(founder)).cash).toMatchObject({ feePaise: 100_000, taxPaise: 18_000, totalPaise: 118_000 });

      const csv = await call("GET", `/sales/exports/payments.csv?from=${istDate(-30)}&to=${istDate(0)}`, { cookie: founder.cookie });
      expect(csv.status).toBe(200);
      expect(csv.headers.get("content-type")).toContain("text/csv");
      expect(csv.text.trim().split("\r\n")).toHaveLength(2);

      await call("POST", "/sales/tasks", { cookie: founder.cookie, body: { title: "Chase payment", companyId: company.id, dueAt: isoIn(-1) } });
      const today = (await call("GET", "/sales/today", { cookie: founder.cookie })).body;
      expect(today.overdueFollowUps.map((t: { title: string }) => t.title)).toContain("Chase payment");
      const cal = (await call("GET", `/sales/calendar?from=${istDate(-2)}&to=${istDate(0)}&types=task`, { cookie: founder.cookie })).body;
      expect(cal.events.map((e: { title: string }) => e.title)).toContain("Chase payment");
    });
  });

  describe("dates outside the sprint", () => {
    it("counts cash on a selected day before the sprint starts and rejects inverted report ranges", async () => {
      const founder = await bootstrapFounder();
      await setConfig(founder, (c) => ({ ...c, sprint: { start: istDate(1), end: istDate(30) } }));
      const { company } = await createCompany(founder, { name: "Early Co" });
      await acceptedProposal(founder, company.id);
      const p = await payment(founder, { companyId: company.id, kind: "first_month", feePaise: 2_500_000, taxPaise: 450_000, receivedAt: new Date().toISOString() });
      expect((await verify(founder, p.id)).status).toBe(200);

      const today = (await call("GET", "/sales/today", { cookie: founder.cookie })).body;
      expect(today.newPaying).toMatchObject({ sprintToDate: 0, selectedDay: 1 });
      expect(today.revenue.cashCollected.selectedDay).toEqual({ feePaise: 2_500_000, taxPaise: 450_000, totalPaise: 2_950_000 });
      expect(today.revenue.cashCollected.sprintToDate.totalPaise).toBe(0);

      const inverted = await call("GET", `/sales/reports?from=${istDate(0)}&to=${istDate(-1)}`, { cookie: founder.cookie });
      expect(inverted.status).toBe(400);
    });
  });

  describe("pilots", () => {
    async function activePilot(founder: Session, name = "Pilot Co", extra: Record<string, unknown> = {}) {
      const { company } = await createCompany(founder, { name });
      const pilot = await createPilot(founder, company.id, extra);
      expect((await pilotStatus(founder, pilot.id, { to: "Setup" })).status).toBe(200);
      return pilot;
    }

    it("requires a founder override with a reason at capacity, and audits it", async () => {
      const founder = await bootstrapFounder();
      await setConfig(founder, (c) => ({ ...c, pilot: { ...c.pilot, activeCapacity: 1 } }));
      await activePilot(founder, "First Pilot Co");
      const { company } = await createCompany(founder, { name: "Second Pilot Co" });
      const second = await createPilot(founder, company.id);
      const blocked = await pilotStatus(founder, second.id, { to: "Setup" });
      expect(blocked.status).toBe(409);
      expect(blocked.body).toMatchObject({ code: "capacity", active: 1, capacity: 1 });
      const overridden = await pilotStatus(founder, second.id, { to: "Setup", overrideReason: "Strategic logo" });
      expect(overridden.status).toBe(200);
      expect(overridden.body.pilot.capacityOverrideReason).toBe("Strategic logo");
      const audit = await db.select().from(salesAuditTable).where(and(eq(salesAuditTable.entity, "sales_pilot"), eq(salesAuditTable.action, "capacity_override")));
      expect(audit).toHaveLength(1);
      expect(audit[0]!.reason).toBe("Strategic logo");

      const missing = await createPilot(founder, company.id, { approvedScript: null, reviewAt: null });
      const incomplete = await pilotStatus(founder, missing.id, { to: "Setup" });
      expect(incomplete.status).toBe(400);
      expect(incomplete.body.errors).toEqual(expect.arrayContaining(["Setup requires an approved script", "Setup requires a booked review time"]));
      expect((await pilotStatus(founder, second.id, { to: "Completed" })).status).toBe(400);
      expect((await pilotStatus(founder, second.id, { to: "Cancelled" })).status).toBe(400);
      expect((await pilotStatus(founder, second.id, { to: "Cancelled", reason: "Buyer paused" })).status).toBe(200);
    });

    it("closes its review tasks when the pilot completes or is cancelled", async () => {
      const founder = await bootstrapFounder();
      const reviewTasks = async (pilotId: number) =>
        (await call("GET", "/sales/tasks?status=all", { cookie: founder.cookie })).body.items
          .filter((t: { pilotId: number | null }) => t.pilotId === pilotId)
          .map((t: { kind: string; status: string }) => t.status);

      const done = await activePilot(founder, "Done Pilot Co");
      for (const to of ["Calling", "Review due", "Completed"]) expect((await pilotStatus(founder, done.id, { to })).status).toBe(200);
      expect(await reviewTasks(done.id)).toEqual(["done"]);

      const dropped = await activePilot(founder, "Dropped Pilot Co");
      const ext = await call("POST", `/sales/pilots/${dropped.id}/extension`, { cookie: founder.cookie, body: { attempts: 150, reason: "More data", costLimitPaise: 100_000, reviewAt: isoIn(5) } });
      expect(ext.status).toBe(200);
      expect((await pilotStatus(founder, dropped.id, { to: "Cancelled", reason: "Buyer paused" })).status).toBe(200);
      expect(await reviewTasks(dropped.id)).toEqual(["cancelled", "cancelled"]);
      expect((await call("GET", "/sales/today", { cookie: founder.cookie })).body.overdueFollowUps).toEqual([]);
    });

    it("allows exactly one extension within the configured range", async () => {
      const founder = await bootstrapFounder();
      const pilot = await activePilot(founder);
      const base = { reason: "Needs more data", costLimitPaise: 200_000, reviewAt: isoIn(5) };
      expect((await call("POST", `/sales/pilots/${pilot.id}/extension`, { cookie: founder.cookie, body: { ...base, attempts: 50 } })).status).toBe(400);
      expect((await call("POST", `/sales/pilots/${pilot.id}/extension`, { cookie: founder.cookie, body: { ...base, attempts: 250 } })).status).toBe(400);
      expect((await call("POST", `/sales/pilots/${pilot.id}/extension`, { cookie: founder.cookie, body: { ...base, attempts: 150, reason: "" } })).status).toBe(400);
      const ok = await call("POST", `/sales/pilots/${pilot.id}/extension`, { cookie: founder.cookie, body: { ...base, attempts: 150 } });
      expect(ok.status).toBe(200);
      expect(ok.body.pilot.allowance).toMatchObject({ baseAllowance: 200, extensionAttempts: 150, revisedAllowance: 350 });
      const again = await call("POST", `/sales/pilots/${pilot.id}/extension`, { cookie: founder.cookie, body: { ...base, attempts: 100 } });
      expect(again.status).toBe(409);
      const cal = (await call("GET", `/sales/calendar?from=${istDate(0)}&to=${istDate(7)}&types=extension_review,pilot_review`, { cookie: founder.cookie })).body;
      expect(cal.events.map((e: { type: string }) => e.type).sort()).toEqual(["extension_review", "pilot_review"]);
    });

    it("CSV re-import does not double, corrections are audited, inconsistent rows are rejected", async () => {
      const founder = await bootstrapFounder();
      const pilot = await activePilot(founder);
      const asOf = new Date(Date.now() - DAY).toISOString();
      const row = { asOf, attempts: "120", distinctRecords: "100", answered: "60", meaningful: "30", qualifiedPeople: "10", acceptedOutcomes: "5", callbackRequests: "4", confirmedAppointments: "3", costRupees: "1,250.50" };
      const bad = { ...row, asOf: new Date().toISOString(), answered: "130" };
      const first = await call("POST", `/sales/pilots/${pilot.id}/snapshots/import`, { cookie: founder.cookie, body: { filename: "day1.csv", rows: [row, bad] } });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ created: 1, corrected: 0, unchanged: 0 });
      expect(first.body.rejected).toEqual([{ row: 2, reason: expect.stringContaining("answered") }]);
      expect(first.body.pilot.latestSnapshot.costPaise).toBe(125_050);

      const second = await call("POST", `/sales/pilots/${pilot.id}/snapshots/import`, { cookie: founder.cookie, body: { filename: "day1.csv", rows: [row] } });
      expect(second.body).toMatchObject({ created: 0, corrected: 0, unchanged: 1 });
      expect(await db.select().from(salesPilotSnapshotsTable).where(eq(salesPilotSnapshotsTable.pilotId, pilot.id))).toHaveLength(1);

      const corrected = await call("POST", `/sales/pilots/${pilot.id}/snapshots/import`, { cookie: founder.cookie, body: { filename: "day1-fixed.csv", rows: [{ ...row, answered: "65" }] } });
      expect(corrected.body).toMatchObject({ created: 0, corrected: 1 });
      const [audit] = await db.select().from(salesAuditTable).where(and(eq(salesAuditTable.entity, "sales_pilot_snapshot"), eq(salesAuditTable.action, "corrected")));
      expect(audit).toMatchObject({ before: { answered: 60 }, after: { answered: 65 } });
    });

    it("flags over-allowance but keeps the results, and reports null rates on zero denominators", async () => {
      const founder = await bootstrapFounder();
      const pilot = await activePilot(founder);
      const zero = await call("POST", `/sales/pilots/${pilot.id}/snapshots`, {
        cookie: founder.cookie,
        body: { snapshotKey: "day0", asOf: new Date(Date.now() - 2 * DAY).toISOString(), attempts: 10, distinctRecords: 10, answered: 0, meaningful: 0, qualifiedPeople: 0, acceptedOutcomes: 0, callbackRequests: 0, confirmedAppointments: 0 },
      });
      expect(zero.body.pilot.rates.answerRate).toMatchObject({ value: 0, numerator: 0, denominator: 10 });
      expect(zero.body.pilot.rates.acceptedRate).toMatchObject({ value: null, numerator: 0, denominator: 0 });
      const report0 = (await call("GET", `/sales/pilots/${pilot.id}/report`, { cookie: founder.cookie })).body;
      expect(report0.rates.acceptedRate).toMatchObject({ value: null, insufficientData: true, display: "insufficient data" });

      const over = await call("POST", `/sales/pilots/${pilot.id}/snapshots`, {
        cookie: founder.cookie,
        body: { snapshotKey: "day2", asOf: new Date().toISOString(), attempts: 260, distinctRecords: 200, answered: 120, meaningful: 60, qualifiedPeople: 20, acceptedOutcomes: 10, callbackRequests: 7, confirmedAppointments: 5 },
      });
      expect(over.status).toBe(201);
      expect(over.body.pilot.allowance).toMatchObject({ revisedAllowance: 200, attemptsUsed: 260, overAllowance: true, overBy: 60, remaining: 0 });
      expect(over.body.pilot.latestSnapshot.attempts).toBe(260);
      expect(over.body.pilot.status).toBe("Setup");
    });

    it("the printable report excludes internal notes and unauthorized recordings, and never invents numbers", async () => {
      const founder = await bootstrapFounder();
      const pilot = await activePilot(founder, "Report Co", {
        internalNotes: "SECRET-INTERNAL margin note",
        customerReportNotes: "Calls ran smoothly",
        recordingLinks: [
          { url: "https://rec.example.com/ok.mp3", label: "Approved call", authorized: true },
          { url: "https://rec.example.com/private.mp3", label: "Not approved", authorized: false },
        ],
      });
      const empty = await call("GET", `/sales/pilots/${pilot.id}/report`, { cookie: founder.cookie });
      expect(empty.status).toBe(200);
      expect(empty.text).not.toContain("SECRET-INTERNAL");
      expect(empty.text).not.toContain("private.mp3");
      expect(empty.body.hasData).toBe(false);
      expect(empty.body.metrics.answered).toMatchObject({ value: null, insufficientData: true });
      expect(empty.body.recordingLinks).toEqual([{ url: "https://rec.example.com/ok.mp3", label: "Approved call" }]);
      expect(empty.body.notes).toBe("Calls ran smoothly");

      const detail = (await call("GET", `/sales/pilots/${pilot.id}`, { cookie: founder.cookie })).body;
      expect(detail.pilot.internalNotes).toBe("SECRET-INTERNAL margin note");
    });
  });
});
