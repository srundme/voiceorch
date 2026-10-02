import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesPaymentsTable,
  salesPilotsTable,
  salesProposalsTable,
  salesStageHistoryTable,
  salesSubscriptionsTable,
  salesTasksTable,
  salesUsersTable,
} from "@workspace/db/schema";
import { createSalesRouter } from "./router.js";
import { tryCreateSalesTestDb } from "./test-db.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ADMIN_TOKEN = "sales-test-admin-token";
const testDb = await tryCreateSalesTestDb();

interface CallResult {
  status: number;
  body: any;
  setCookie: string | null;
  cookie: string | null;
}

interface Session {
  cookie: string;
  user: { id: number; email: string; role: string };
}

describe.skipIf(!testDb)(`sales API over HTTP (${testDb?.driver ?? "no db"})`, () => {
  const db = testDb!.db;
  let server: Server;
  let origin = "";
  const previousAdminToken = process.env["ADMIN_TOKEN"];

  beforeEach(async () => {
    process.env["ADMIN_TOKEN"] = ADMIN_TOKEN;
    await testDb!.reset();
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use("/api", createSalesRouter(db));
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
        origin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  afterAll(async () => {
    if (previousAdminToken === undefined) delete process.env["ADMIN_TOKEN"];
    else process.env["ADMIN_TOKEN"] = previousAdminToken;
    await testDb?.close();
  });

  async function call(
    method: string,
    path: string,
    opts: { body?: unknown; cookie?: string | null; csrf?: boolean; admin?: boolean } = {},
  ): Promise<CallResult> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.cookie) headers["cookie"] = opts.cookie;
    if (opts.csrf !== false && method !== "GET") headers["x-sales-request"] = "1";
    if (opts.admin) headers["x-admin-token"] = ADMIN_TOKEN;
    const res = await fetch(`${origin}/api${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const setCookie = res.headers.get("set-cookie");
    const token = setCookie?.match(/ss_sales=([^;]+)/)?.[1];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie, cookie: token ? `ss_sales=${token}` : null };
  }

  async function bootstrapFounder(email = "founder@snapserve.ai", password = "founder-pass-123"): Promise<Session> {
    const boot = await call("POST", "/admin/sales/bootstrap", { admin: true, body: { email } });
    expect(boot.status).toBe(201);
    const accepted = await call("POST", `/sales/invites/${boot.body.token}/accept`, { body: { name: "Founder", password } });
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

  async function createCompany(session: Session, body: Record<string, unknown>) {
    return call("POST", "/sales/companies", { cookie: session.cookie, body });
  }

  describe("auth", () => {
    it("bootstrap is admin-only and only works while no active founder exists", async () => {
      expect((await call("POST", "/admin/sales/bootstrap", { body: { email: "a@b.co" } })).status).toBe(403);
      const boot = await call("POST", "/admin/sales/bootstrap", { admin: true, body: { email: "Founder@SnapServe.ai" } });
      expect(boot.status).toBe(201);
      expect(boot.body.inviteUrlPath).toBe(`/sales/invite/${boot.body.token}`);

      const lookup = await call("GET", `/sales/invites/${boot.body.token}`);
      expect(lookup.body).toMatchObject({ email: "founder@snapserve.ai", role: "founder" });

      expect((await call("POST", `/sales/invites/${boot.body.token}/accept`, { body: { name: "F", password: "short" } })).status).toBe(400);
      const accepted = await call("POST", `/sales/invites/${boot.body.token}/accept`, { body: { name: "F", password: "long-enough-pw" } });
      expect(accepted.status).toBe(201);
      expect(accepted.setCookie).toMatch(/HttpOnly/i);
      expect(accepted.setCookie).toMatch(/SameSite=Strict/i);
      expect(accepted.setCookie).toMatch(/Path=\/api\/sales/);

      expect((await call("POST", `/sales/invites/${boot.body.token}/accept`, { body: { name: "F", password: "long-enough-pw" } })).status).toBe(404);
      expect((await call("POST", "/admin/sales/bootstrap", { admin: true, body: { email: "other@b.co" } })).status).toBe(409);
    });

    it("login, me and logout", async () => {
      await bootstrapFounder();
      const bad = await call("POST", "/sales/auth/login", { body: { email: "founder@snapserve.ai", password: "wrong-password" } });
      expect(bad.status).toBe(401);
      const unknown = await call("POST", "/sales/auth/login", { body: { email: "nobody@snapserve.ai", password: "wrong-password" } });
      expect(unknown.body.error).toBe(bad.body.error);

      const ok = await call("POST", "/sales/auth/login", { body: { email: "FOUNDER@snapserve.ai", password: "founder-pass-123" } });
      expect(ok.status).toBe(200);
      const me = await call("GET", "/sales/auth/me", { cookie: ok.cookie });
      expect(me.body.user).toMatchObject({ email: "founder@snapserve.ai", role: "founder" });

      expect((await call("POST", "/sales/auth/logout", { cookie: ok.cookie })).status).toBe(200);
      expect((await call("GET", "/sales/auth/me", { cookie: ok.cookie })).status).toBe(401);
      expect((await call("GET", "/sales/auth/me")).status).toBe(401);
    });

    it("locks the account after 8 failed logins", async () => {
      const founder = await bootstrapFounder();
      for (let i = 0; i < 8; i++) {
        expect((await call("POST", "/sales/auth/login", { body: { email: "founder@snapserve.ai", password: `nope-${i}` } })).status).toBe(401);
      }
      const locked = await call("POST", "/sales/auth/login", { body: { email: "founder@snapserve.ai", password: "founder-pass-123" } });
      expect(locked.status).toBe(401);
      const [row] = await db.select().from(salesUsersTable).where(eq(salesUsersTable.id, founder.user.id));
      expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      await db.update(salesUsersTable).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(salesUsersTable.id, founder.user.id));
      expect((await call("POST", "/sales/auth/login", { body: { email: "founder@snapserve.ai", password: "founder-pass-123" } })).status).toBe(200);
    });

    it("requires X-Sales-Request on mutating requests", async () => {
      const founder = await bootstrapFounder();
      expect((await call("POST", "/sales/auth/login", { csrf: false, body: { email: "founder@snapserve.ai", password: "founder-pass-123" } })).status).toBe(403);
      expect((await call("POST", "/sales/companies", { csrf: false, cookie: founder.cookie, body: { name: "Acme" } })).status).toBe(403);
      expect((await call("GET", "/sales/companies", { cookie: founder.cookie })).status).toBe(200);
    });

    it("deactivating a user kills existing sessions immediately", async () => {
      const founder = await bootstrapFounder();
      const mate = await addTeammate(founder);
      expect((await call("GET", "/sales/auth/me", { cookie: mate.cookie })).status).toBe(200);

      const patched = await call("PATCH", `/sales/users/${mate.user.id}`, { cookie: founder.cookie, body: { status: "deactivated" } });
      expect(patched.status).toBe(200);
      expect((await call("GET", "/sales/auth/me", { cookie: mate.cookie })).status).toBe(401);
      expect((await call("POST", "/sales/auth/login", { body: { email: "mate@snapserve.ai", password: "teammate-pass-1" } })).status).toBe(401);

      await call("PATCH", `/sales/users/${mate.user.id}`, { cookie: founder.cookie, body: { status: "active" } });
      const relogin = await call("POST", "/sales/auth/login", { body: { email: "mate@snapserve.ai", password: "teammate-pass-1" } });
      expect(relogin.status).toBe(200);

      await db.update(salesUsersTable).set({ status: "deactivated" }).where(eq(salesUsersTable.id, mate.user.id));
      expect((await call("GET", "/sales/auth/me", { cookie: relogin.cookie })).status).toBe(401);
    });

    it("keeps at least one active founder", async () => {
      const founder = await bootstrapFounder();
      const res = await call("PATCH", `/sales/users/${founder.user.id}`, { cookie: founder.cookie, body: { role: "teammate" } });
      expect(res.status).toBe(400);
    });
  });

  describe("teammate permissions", () => {
    it("cannot manage settings, users or targets", async () => {
      const founder = await bootstrapFounder();
      const mate = await addTeammate(founder);
      const settings = await call("GET", "/sales/settings", { cookie: mate.cookie });
      expect(settings.status).toBe(200);
      const config = settings.body.config;

      expect((await call("PUT", "/sales/settings", { cookie: mate.cookie, body: { config } })).status).toBe(403);
      expect((await call("GET", "/sales/users", { cookie: mate.cookie })).status).toBe(403);
      expect((await call("POST", "/sales/users", { cookie: mate.cookie, body: { email: "x@y.co", role: "teammate" } })).status).toBe(403);
      expect((await call("GET", "/sales/team", { cookie: mate.cookie })).body.users).toHaveLength(2);

      const targets = await call("GET", "/sales/targets?kind=daily", { cookie: mate.cookie });
      expect(targets.body.targets).toHaveLength(30);
      expect((await call("PATCH", `/sales/targets/${targets.body.targets[0].id}`, { cookie: mate.cookie, body: { visits: 1 } })).status).toBe(403);

      const updated = await call("PUT", "/sales/settings", {
        cookie: founder.cookie,
        body: { config: { ...config, responseTargetMinutes: 10 }, reason: "Faster SLA" },
      });
      expect(updated.status).toBe(200);
      expect((await call("GET", "/sales/settings", { cookie: mate.cookie })).body.config.responseTargetMinutes).toBe(10);
      expect((await call("PUT", "/sales/settings", { cookie: founder.cookie, body: { config: { ...config, sprint: { start: "x" } } } })).status).toBe(400);
    });

    it("cannot edit a founder-owned company but can self-assign unowned leads", async () => {
      const founder = await bootstrapFounder();
      const mate = await addTeammate(founder);
      const owned = await createCompany(founder, { name: "Founder Co" });
      expect(owned.status).toBe(201);
      const id = owned.body.company.id;

      expect((await call("GET", `/sales/companies/${id}`, { cookie: mate.cookie })).status).toBe(200);
      expect((await call("PATCH", `/sales/companies/${id}`, { cookie: mate.cookie, body: { area: "HSR" } })).status).toBe(403);
      expect((await call("POST", `/sales/companies/${id}/contacts`, { cookie: mate.cookie, body: { name: "X" } })).status).toBe(403);
      expect((await call("POST", `/sales/companies/${id}/owner`, { cookie: mate.cookie, body: { ownerId: mate.user.id } })).status).toBe(403);

      const inbound = await createCompany(founder, { name: "Inbound Lead", source: "website_form", ownerId: null });
      const inboundId = inbound.body.company.id;
      expect((await call("POST", `/sales/companies/${inboundId}/owner`, { cookie: mate.cookie, body: { ownerId: founder.user.id } })).status).toBe(403);
      const claimed = await call("POST", `/sales/companies/${inboundId}/owner`, { cookie: mate.cookie, body: { ownerId: mate.user.id } });
      expect(claimed.status).toBe(200);
      expect(claimed.body.company.ownerId).toBe(mate.user.id);
      const [firstResponse] = await db.select().from(salesTasksTable).where(eq(salesTasksTable.companyId, inboundId));
      expect(firstResponse).toMatchObject({ kind: "first_response", ownerId: mate.user.id });
      expect((await call("PATCH", `/sales/companies/${inboundId}`, { cookie: mate.cookie, body: { area: "HSR" } })).status).toBe(200);

      const own = await createCompany(mate, { name: "Mate Lead" });
      expect(own.body.company.ownerId).toBe(mate.user.id);
      expect((await createCompany(mate, { name: "Someone else's", ownerId: founder.user.id })).status).toBe(403);
    });

    it("cannot bypass stages even on own opportunity", async () => {
      const founder = await bootstrapFounder();
      const mate = await addTeammate(founder);
      const created = await createCompany(mate, { name: "Mate Prospect", painPoint: "Missed calls", callingVolume: 2000, budgetFit: "yes", decisionMaker: "Owner" });
      const oppId = created.body.opportunity.id;
      expect((await call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: mate.cookie, body: { to: "Qualified" } })).status).toBe(200);
      const bypass = await call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: mate.cookie, body: { to: "Proposal", bypassReason: "Hot lead" } });
      expect(bypass.status).toBe(403);

      const foreign = await createCompany(founder, { name: "Founder Prospect" });
      expect((await call("POST", `/sales/opportunities/${foreign.body.opportunity.id}/stage`, { cookie: mate.cookie, body: { to: "Lost", evidence: { reason: "x" } } })).status).toBe(403);
    });
  });

  describe("companies and dedupe", () => {
    it("rejects exact domain/phone/email duplicates and flags fuzzy names", async () => {
      const founder = await bootstrapFounder();
      const first = await createCompany(founder, {
        name: "Acme HR Solutions",
        website: "https://www.acme-hr.in/about",
        sector: "HR consultancy",
        city: "Bengaluru",
        area: "Koramangala",
        contacts: [{ name: "Ravi", phone: "98450 12345", email: "ravi@acmehr-mail.in", isDecisionMaker: true }],
      });
      expect(first.status).toBe(201);
      expect(first.body.company.domainNormalized).toBe("acme-hr.in");
      expect(first.body.opportunity.stage).toBe("Identified");
      const id = first.body.company.id;

      const byDomain = await createCompany(founder, { name: "Totally Different", website: "acme-hr.in" });
      expect(byDomain.status).toBe(409);
      expect(byDomain.body).toMatchObject({ existingCompanyId: id, matchedOn: "domain" });

      const byPhone = await createCompany(founder, { name: "Other", contacts: [{ name: "R", phone: "+91-98450-12345" }] });
      expect(byPhone.body).toMatchObject({ existingCompanyId: id, matchedOn: "phone" });
      expect(byPhone.status).toBe(409);

      const byEmail = await createCompany(founder, { name: "Other 2", contacts: [{ name: "R", email: "RAVI@acmehr-mail.in" }] });
      expect(byEmail.body).toMatchObject({ existingCompanyId: id, matchedOn: "email" });

      const fuzzy = await createCompany(founder, { name: "Acme HR Solutions Pvt Ltd" });
      expect(fuzzy.status).toBe(201);
      expect(fuzzy.body.dedupe).toEqual({ needsReview: true, duplicateOfCompanyId: id });
      expect(fuzzy.body.company.needsDedupeReview).toBe(true);

      const demo = await createCompany(founder, { name: "Acme demo", website: "acme-hr.in", isDemo: true });
      expect(demo.status).toBe(201);

      expect((await createCompany(founder, { name: "Bad source", source: "tv_ad" })).status).toBe(400);
    });

    it("lists with search and filters, and returns full detail", async () => {
      const founder = await bootstrapFounder();
      const a = await createCompany(founder, { name: "Sunrise Realty", area: "Whitefield", city: "Bengaluru", contacts: [{ name: "Asha", phone: "9876500001" }] });
      await createCompany(founder, { name: "Lotus Loans", area: "Indiranagar", city: "Bengaluru", ownerId: null, source: "instagram_ad" });

      const byPhone = await call("GET", "/sales/companies?q=98765", { cookie: founder.cookie });
      expect(byPhone.body.items.map((c: { name: string }) => c.name)).toEqual(["Sunrise Realty"]);
      const byArea = await call("GET", "/sales/companies?q=indira", { cookie: founder.cookie });
      expect(byArea.body.total).toBe(1);
      const unassigned = await call("GET", "/sales/companies?unassigned=1", { cookie: founder.cookie });
      expect(unassigned.body.items.map((c: { name: string }) => c.name)).toEqual(["Lotus Loans"]);
      const byStage = await call("GET", "/sales/companies?stage=Identified&pageSize=1", { cookie: founder.cookie });
      expect(byStage.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
      expect(byStage.body.items).toHaveLength(1);

      const detail = await call("GET", `/sales/companies/${a.body.company.id}`, { cookie: founder.cookie });
      expect(detail.body.contacts[0].phoneNormalized).toBe("+919876500001");
      expect(detail.body.opportunity.stage).toBe("Identified");
      expect(detail.body.stageHistory).toHaveLength(1);
      expect(detail.body.owner).toMatchObject({ id: founder.user.id });
    });
  });

  describe("stage changes", () => {
    it("enforces evidence, records history and never bypasses Paid", async () => {
      const founder = await bootstrapFounder();
      const created = await createCompany(founder, { name: "Pipeline Co", contacts: [{ name: "Buyer", isDecisionMaker: true }] });
      const companyId = created.body.company.id;
      const oppId = created.body.opportunity.id;
      const contactId = created.body.contacts[0].id;
      const stage = (body: Record<string, unknown>) => call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: founder.cookie, body });

      expect((await stage({ to: "Demo booked" })).status).toBe(400);
      const missing = await stage({ to: "Qualified" });
      expect(missing.status).toBe(400);
      expect(missing.body.errors.length).toBeGreaterThanOrEqual(3);

      const qualified = await stage({
        to: "Qualified",
        evidence: { qualification: { need: "Speed to lead", callingVolume: 4000, budgetFit: "yes", decisionMakerContactId: contactId } },
      });
      expect(qualified.status).toBe(200);
      expect(qualified.body.history).toMatchObject({ fromStage: "Identified", toStage: "Qualified", changedBy: founder.user.id });

      const noProposal = await stage({ to: "Proposal", bypassReason: "Referral wants pricing" });
      expect(noProposal.status).toBe(400);
      await db.insert(salesProposalsTable).values({ companyId, opportunityId: oppId, monthlyFeePaise: 2_500_000, status: "sent" });
      const bypassed = await stage({ to: "Proposal", bypassReason: "Referral wants pricing" });
      expect(bypassed.status).toBe(200);
      expect(bypassed.body.bypass).toBe(true);

      expect((await stage({ to: "Paid", bypassReason: "Trust me" })).status).toBe(400);
      await db.update(salesProposalsTable).set({ status: "accepted", termsAcceptedAt: new Date(), termsAcceptedBy: "Buyer" }).where(eq(salesProposalsTable.companyId, companyId));
      const [payment] = await db
        .insert(salesPaymentsTable)
        .values({ companyId, kind: "first_month", feePaise: 2_500_000, taxPaise: 450_000, receivedAt: new Date("2026-10-08T06:00:00Z"), status: "recorded" })
        .returning();
      const unverified = await stage({ to: "Paid", bypassReason: "Trust me" });
      expect(unverified.status).toBe(400);
      expect(unverified.body.errors.join(" ")).toContain("verified first-month payment");

      await db.update(salesPaymentsTable).set({ status: "verified", verifiedAt: new Date() }).where(eq(salesPaymentsTable.id, payment!.id));
      expect((await stage({ to: "Paid" })).status).toBe(200);
      const [company] = await db.select().from(salesCompaniesTable).where(eq(salesCompaniesTable.id, companyId));
      expect(company!.firstPaidAt?.toISOString()).toBe("2026-10-08T06:00:00.000Z");

      expect((await stage({ to: "Proposal" })).status).toBe(400);
      expect((await stage({ to: "Proposal", note: "Payment bounced" })).status).toBe(200);

      const history = await db.select().from(salesStageHistoryTable).where(eq(salesStageHistoryTable.opportunityId, oppId));
      expect(history.map((h) => h.toStage)).toEqual(["Identified", "Qualified", "Proposal", "Paid", "Proposal"]);
      expect(history.find((h) => h.bypass)?.toStage).toBe("Proposal");
    });

    it("Later needs a future date and creates a follow-up task; Lost needs a reason", async () => {
      const founder = await bootstrapFounder();
      const created = await createCompany(founder, { name: "Later Co" });
      const oppId = created.body.opportunity.id;
      const stage = (body: Record<string, unknown>) => call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: founder.cookie, body });

      expect((await stage({ to: "Later", evidence: { reason: "Budget", actionAt: "2020-01-01T00:00:00Z" } })).status).toBe(400);
      const actionAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      expect((await stage({ to: "Later", evidence: { reason: "Budget next month", actionAt } })).status).toBe(200);
      const tasks = await db.select().from(salesTasksTable).where(eq(salesTasksTable.opportunityId, oppId));
      expect(tasks.some((t) => t.kind === "follow_up" && t.dueAt?.toISOString() === actionAt)).toBe(true);

      expect((await stage({ to: "Identified" })).status).toBe(200);
      expect((await stage({ to: "Lost" })).status).toBe(400);
      expect((await stage({ to: "Lost", evidence: { reason: "No budget" } })).status).toBe(200);
      expect((await stage({ to: "Identified", note: "reopen" })).status).toBe(400);
    });
  });

  describe("activities", () => {
    async function today(session: Session, query = "") {
      const res = await call("GET", `/sales/today${query}`, { cookie: session.cookie });
      expect(res.status).toBe(200);
      return res.body;
    }

    it("counts flags once across create and edit, and never counts cancelled activities", async () => {
      const founder = await bootstrapFounder();
      const company = await createCompany(founder, { name: "Visit Co" });
      const companyId = company.body.company.id;

      const visit = await call("POST", "/sales/activities", {
        cookie: founder.cookie,
        body: { companyId, type: "visit", flags: { buyerConversation: true }, nextAction: "Send deck", nextActionDueAt: new Date(Date.now() + 86_400_000).toISOString() },
      });
      expect(visit.status).toBe(201);
      expect(visit.body.activity).toMatchObject({ flagVisit: true, flagFirstVisit: true, flagBuyerConversation: true });
      let t = await today(founder);
      expect(t.activity.actual).toMatchObject({ visits: 1, firstVisits: 1, conversations: 1, demos: 0 });

      const edited = await call("PATCH", `/sales/activities/${visit.body.activity.id}`, { cookie: founder.cookie, body: { notes: "Met owner", flags: { buyerConversation: true } } });
      expect(edited.status).toBe(200);
      t = await today(founder);
      expect(t.activity.actual).toMatchObject({ visits: 1, conversations: 1 });

      const second = await call("POST", "/sales/activities", { cookie: founder.cookie, body: { companyId, type: "visit" } });
      expect(second.body.activity.flagFirstVisit).toBe(false);
      t = await today(founder);
      expect(t.activity.actual).toMatchObject({ visits: 2, firstVisits: 1 });

      expect((await call("POST", `/sales/activities/${visit.body.activity.id}/cancel`, { cookie: founder.cookie, body: { reason: "Logged twice" } })).status).toBe(200);
      t = await today(founder);
      expect(t.activity.actual).toMatchObject({ visits: 1, firstVisits: 1, conversations: 0 });
      const [secondRow] = await db.select().from(salesActivitiesTable).where(eq(salesActivitiesTable.id, second.body.activity.id));
      expect(secondRow!.flagFirstVisit).toBe(true);

      const [companyRow] = await db.select().from(salesCompaniesTable).where(eq(salesCompaniesTable.id, companyId));
      expect(companyRow!.nextAction).toBe("Send deck");
      expect(companyRow!.lastActivityAt).not.toBeNull();
      const followUps = await db.select().from(salesTasksTable).where(eq(salesTasksTable.dedupeKey, `activity:${visit.body.activity.id}:next_action`));
      expect(followUps).toHaveLength(1);
    });

    it("scheduled demos create a task, count only when completed, and cancelled demos never count", async () => {
      const founder = await bootstrapFounder();
      const company = await createCompany(founder, { name: "Demo Co", contacts: [{ name: "Buyer" }] });
      const companyId = company.body.company.id;
      const contactId = company.body.contacts[0].id;

      const scheduled = await call("POST", "/sales/activities", {
        cookie: founder.cookie,
        body: { companyId, contactId, type: "demo", status: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000).toISOString() },
      });
      expect(scheduled.status).toBe(201);
      const demoId = scheduled.body.activity.id;
      const [task] = await db.select().from(salesTasksTable).where(eq(salesTasksTable.dedupeKey, `activity:${demoId}:appointment`));
      expect(task).toMatchObject({ kind: "demo", status: "open" });
      expect((await today(founder)).activity.actual.demos).toBe(0);

      const oppId = company.body.opportunity.id;
      await db.update(salesCompaniesTable).set({ painPoint: "x", callingVolume: 100, budgetFit: "yes", decisionMaker: "Y" }).where(eq(salesCompaniesTable.id, companyId));
      expect((await call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: founder.cookie, body: { to: "Qualified" } })).status).toBe(200);
      expect((await call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: founder.cookie, body: { to: "Demo booked" } })).status).toBe(200);
      expect((await call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: founder.cookie, body: { to: "Demo completed" } })).status).toBe(400);

      const completed = await call("PATCH", `/sales/activities/${demoId}`, { cookie: founder.cookie, body: { status: "completed" } });
      expect(completed.body.activity.occurredAt).not.toBeNull();
      expect((await today(founder)).activity.actual.demos).toBe(1);
      const [doneTask] = await db.select().from(salesTasksTable).where(eq(salesTasksTable.id, task!.id));
      expect(doneTask!.status).toBe("done");
      expect((await call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: founder.cookie, body: { to: "Demo completed" } })).status).toBe(200);

      const other = await call("POST", "/sales/activities", {
        cookie: founder.cookie,
        body: { companyId, type: "demo", status: "scheduled", scheduledAt: new Date(Date.now() + 7_200_000).toISOString() },
      });
      await call("POST", `/sales/activities/${other.body.activity.id}/cancel`, { cookie: founder.cookie, body: {} });
      expect((await today(founder)).activity.actual.demos).toBe(1);

      await call("POST", `/sales/activities/${demoId}/cancel`, { cookie: founder.cookie, body: {} });
      expect((await today(founder)).activity.actual.demos).toBe(0);
    });

    it("teammates can only edit their own activities and tasks", async () => {
      const founder = await bootstrapFounder();
      const mate = await addTeammate(founder);
      const company = await createCompany(founder, { name: "Shared Co" });
      const act = await call("POST", "/sales/activities", { cookie: founder.cookie, body: { companyId: company.body.company.id, type: "call" } });
      expect((await call("PATCH", `/sales/activities/${act.body.activity.id}`, { cookie: mate.cookie, body: { notes: "x" } })).status).toBe(403);

      const task = await call("POST", "/sales/tasks", { cookie: founder.cookie, body: { title: "Call back", companyId: company.body.company.id } });
      expect(task.status).toBe(201);
      expect((await call("POST", `/sales/tasks/${task.body.task.id}/complete`, { cookie: mate.cookie, body: { outcome: "x" } })).status).toBe(403);
      expect((await call("POST", `/sales/tasks/${task.body.task.id}/assign`, { cookie: mate.cookie, body: { ownerId: mate.user.id } })).status).toBe(403);
      const reassigned = await call("POST", `/sales/tasks/${task.body.task.id}/assign`, { cookie: founder.cookie, body: { ownerId: mate.user.id } });
      expect(reassigned.body.task.ownerId).toBe(mate.user.id);
      const mine = await call("GET", "/sales/tasks", { cookie: mate.cookie });
      expect(mine.body.scope).toBe("mine");
      expect(mine.body.items).toHaveLength(1);
      const done = await call("POST", `/sales/tasks/${task.body.task.id}/complete`, { cookie: mate.cookie, body: { outcome: "Booked demo" } });
      expect(done.body.task).toMatchObject({ status: "done", outcome: "Booked demo", completedBy: mate.user.id });
    });
  });

  describe("today", () => {
    it("returns zeros and labelled nulls on an empty database", async () => {
      const founder = await bootstrapFounder();
      const res = await call("GET", "/sales/today?date=2026-10-05", { cookie: founder.cookie });
      expect(res.status).toBe(200);
      const t = res.body;
      expect(t.scope).toBe("team");
      expect(t.newPaying).toMatchObject({ sprintToDate: 0, selectedDay: 0, operating: { actual: 0, target: 20 }, stretch: { target: 50 } });
      expect(t.newPaying.milestone).toMatchObject({ date: "2026-10-09", operatingPaid: 2, stretchPaid: 5 });
      expect(t.revenue.activeMrrPaise).toBe(0);
      expect(t.revenue.cashCollected.sprintToDate).toEqual({ feePaise: 0, taxPaise: 0, totalPaise: 0 });
      expect(t.activity).toMatchObject({
        dayType: "selling",
        actual: { visits: 0, conversations: 0, demos: 0, pilots: 0 },
        target: { visits: 16, conversations: 6, demos: 3, pilots: 2 },
      });
      expect(t.activity.progress.visits.value).toBe(0);
      expect(t.activePilots).toMatchObject({ count: 0, capacity: 6, utilization: { value: 0 } });
      expect(t.overdueFollowUps).toEqual([]);
      expect(t.actions).toEqual([]);

      const sunday = await call("GET", "/sales/today?date=2026-10-04", { cookie: founder.cookie });
      expect(sunday.body.activity).toMatchObject({ dayType: "review", isReviewDay: true, target: { visits: 0 } });
      expect(sunday.body.activity.progress.visits.value).toBeNull();
      expect(sunday.body.activity.progress.visits.label).toContain("no data");

      const outside = await call("GET", "/sales/today?date=2026-12-25", { cookie: founder.cookie });
      expect(outside.status).toBe(200);
      expect(outside.body.activity.target).toBeNull();
    });

    it("excludes demo records from actual metrics and shows them only with demo=1", async () => {
      const founder = await bootstrapFounder();
      const mate = await addTeammate(founder);
      const at = new Date("2026-10-10T05:00:00Z");
      const [real] = await db.insert(salesCompaniesTable).values({ name: "Real Co", nameNormalized: "real co", ownerId: founder.user.id, firstPaidAt: at }).returning();
      const [demo] = await db.insert(salesCompaniesTable).values({ name: "Demo Co", nameNormalized: "demo co", isDemo: true, ownerId: founder.user.id, firstPaidAt: at }).returning();
      for (const [c, isDemo, fee] of [[real!, false, 2_500_000], [demo!, true, 9_900_000]] as const) {
        await db.insert(salesSubscriptionsTable).values({ companyId: c.id, monthlyFeePaise: fee, status: "active", isDemo, customerOwnerId: founder.user.id });
        await db.insert(salesPaymentsTable).values({ companyId: c.id, kind: "first_month", feePaise: fee, taxPaise: fee * 0.18, receivedAt: at, status: "verified", isDemo });
        await db.insert(salesActivitiesTable).values({ companyId: c.id, ownerId: founder.user.id, type: "visit", status: "completed", occurredAt: at, flagVisit: true, flagBuyerConversation: true, isDemo });
        await db.insert(salesPilotsTable).values({ companyId: c.id, status: "Calling", ownerId: founder.user.id, onboardingStartedAt: at, isDemo });
      }
      await db.insert(salesActivitiesTable).values({ companyId: demo!.id, ownerId: founder.user.id, type: "demo", status: "completed", occurredAt: at, flagDemo: true, isDemo: true });

      const actual = (await call("GET", "/sales/today?date=2026-10-10", { cookie: founder.cookie })).body;
      expect(actual.newPaying.sprintToDate).toBe(1);
      expect(actual.revenue.activeMrrPaise).toBe(2_500_000);
      expect(actual.revenue.cashCollected.sprintToDate).toEqual({ feePaise: 2_500_000, taxPaise: 450_000, totalPaise: 2_950_000 });
      expect(actual.activity.actual).toMatchObject({ visits: 1, conversations: 1, demos: 0, pilots: 1 });
      expect(actual.activePilots.teamCount).toBe(1);

      const demoView = (await call("GET", "/sales/today?date=2026-10-10&demo=1", { cookie: founder.cookie })).body;
      expect(demoView.demo).toBe(true);
      expect(demoView.revenue.activeMrrPaise).toBe(9_900_000);
      expect(demoView.activity.actual).toMatchObject({ visits: 1, demos: 1 });

      const mateView = (await call("GET", "/sales/today?date=2026-10-10", { cookie: mate.cookie })).body;
      expect(mateView.scope).toBe("mine");
      expect(mateView.activity.actual.visits).toBe(0);
      const mateTeam = (await call("GET", "/sales/today?date=2026-10-10&scope=team", { cookie: mate.cookie })).body;
      expect(mateTeam.activity.actual.visits).toBe(1);
    });

    it("prioritises overdue tasks, then appointments, then oldest inbound leads", async () => {
      const founder = await bootstrapFounder();
      const now = Date.now();
      await createCompany(founder, { name: "Old Enquiry", source: "website_form", ownerId: null, originalEnquiryAt: new Date(now - 4 * 86_400_000).toISOString() });
      await createCompany(founder, { name: "New Enquiry", source: "instagram_ad", ownerId: null, originalEnquiryAt: new Date(now - 60_000).toISOString() });
      const owned = await createCompany(founder, { name: "Owned Co" });
      await call("POST", "/sales/tasks", { cookie: founder.cookie, body: { title: "Overdue call", companyId: owned.body.company.id, dueAt: new Date(now - 3_600_000).toISOString() } });

      const t = (await call("GET", "/sales/today", { cookie: founder.cookie })).body;
      const kinds = t.actions.map((a: { kind: string }) => a.kind);
      expect(kinds[0]).toBe("overdue_task");
      expect(kinds.indexOf("inbound_lead")).toBeGreaterThan(kinds.lastIndexOf("overdue_task"));
      const inbound = t.actions.filter((a: { kind: string }) => a.kind === "inbound_lead").map((a: { companyName: string }) => a.companyName);
      expect(inbound).toEqual(["Old Enquiry", "New Enquiry"]);
      expect(t.unassignedInbound[0].breachedResponseTarget).toBe(true);
    });
  });
});
