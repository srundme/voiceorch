import express from "express";
import cookieParser from "cookie-parser";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { salesActivitiesTable, salesAuditTable, salesOpportunitiesTable, salesSubscriptionsTable, salesTargetsTable } from "@workspace/db/schema";
import { createSalesRouter } from "./router.js";
import { salesMigrationStatements, tryCreateSalesTestDb } from "./test-db.js";
import { localDateString } from "./time.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ADMIN_TOKEN = "sales-audit-admin-token";
const WEBHOOK_SECRET = "sales-audit-webhook-secret";
const DAY = 86_400_000;
const testDb = await tryCreateSalesTestDb();

interface CallResult {
  status: number;
  body: any;
  cookie: string | null;
}

interface Session {
  cookie: string;
  user: { id: number; email: string; role: string };
}

const istDate = (offsetDays = 0) => localDateString(new Date(Date.now() + offsetDays * DAY));
const isoIn = (days: number) => new Date(Date.now() + days * DAY).toISOString();

describe.skipIf(!testDb)(`sales audit fixes (${testDb?.driver ?? "no db"})`, () => {
  const db = testDb!.db;
  let server: Server | undefined;
  let origin = "";
  const previousAdminToken = process.env["ADMIN_TOKEN"];
  const previousSecret = process.env["SALES_WEBHOOK_SECRET"];

  beforeEach(async () => {
    process.env["ADMIN_TOKEN"] = ADMIN_TOKEN;
    process.env["SALES_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
    await testDb!.reset();
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => { req.rawBody = buf; } }));
    app.use("/api", createSalesRouter(db));
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server!.address();
        if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
        origin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server!.close((e) => (e ? reject(e) : resolve())));
    server = undefined;
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
    return { status: res.status, body, cookie: token ? `ss_sales=${token}` : null };
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
    return res.body as { company: { id: number }; opportunity: { id: number }; contacts: Array<{ id: number }>; dedupe: { needsReview: boolean } };
  }

  const detail = async (session: Session, id: number) => (await call("GET", `/sales/companies/${id}`, { cookie: session.cookie })).body;

  function signedWebhook(payload: unknown, eventId: string) {
    const raw = JSON.stringify(payload);
    const signature = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex")}`;
    return call("POST", "/sales/webhooks/leads", { raw, csrf: false, headers: { "x-snapserve-signature": signature, "x-event-id": eventId } });
  }

  it("records lastLoginAt when an invite is accepted and keeps deactivated users resolvable by name", async () => {
    const founder = await bootstrapFounder();
    const mate = await addTeammate(founder);
    const users = (await call("GET", "/sales/users", { cookie: founder.cookie })).body.users as Array<{ id: number; lastLoginAt: string | null }>;
    expect(users.every((u) => u.lastLoginAt != null)).toBe(true);

    expect((await call("PATCH", `/sales/users/${mate.user.id}`, { cookie: founder.cookie, body: { status: "deactivated" } })).status).toBe(200);
    const active = (await call("GET", "/sales/team", { cookie: founder.cookie })).body.users;
    expect(active.map((u: { id: number }) => u.id)).not.toContain(mate.user.id);
    const all = (await call("GET", "/sales/team?includeInactive=1", { cookie: founder.cookie })).body.users;
    expect(all.find((u: { id: number }) => u.id === mate.user.id)).toMatchObject({ name: "Mate", status: "deactivated" });
  });

  it("turns Demo booked evidence into one scheduled demo shown in Today and the calendar", async () => {
    const founder = await bootstrapFounder();
    const created = await createCompany(founder, { name: "Demo Evidence Co", ...qualifiedFields, contacts: [{ name: "Buyer", phone: "98450 10101" }] });
    const oppId = created.opportunity.id;
    const buyer = created.contacts[0]!.id;
    expect((await call("POST", `/sales/opportunities/${oppId}/stage`, { cookie: founder.cookie, body: { to: "Qualified" } })).status).toBe(200);
    const demoAt = isoIn(1);
    const moved = await call("POST", `/sales/opportunities/${oppId}/stage`, {
      cookie: founder.cookie,
      body: { to: "Demo booked", evidence: { demoBuyerContactId: buyer, demoAt } },
    });
    expect(moved.status).toBe(200);

    const after = await detail(founder, created.company.id);
    const demos = after.activities.filter((a: { type: string }) => a.type === "demo");
    expect(demos).toHaveLength(1);
    expect(demos[0]).toMatchObject({ status: "scheduled", scheduledAt: demoAt, contactId: buyer, opportunityId: oppId, ownerId: founder.user.id });
    expect(after.tasks.find((t: { dedupeKey: string }) => t.dedupeKey === `activity:${demos[0].id}:appointment`)).toMatchObject({ status: "open", dueAt: demoAt });

    const today = (await call("GET", `/sales/today?date=${istDate(1)}`, { cookie: founder.cookie })).body;
    expect(today.todaysAppointments.find((a: { activityId: number }) => a.activityId === demos[0].id)).toMatchObject({ kind: "demo" });
    const calendar = (await call("GET", `/sales/calendar?from=${istDate(0)}&to=${istDate(2)}&types=activity`, { cookie: founder.cookie })).body;
    expect(calendar.events.find((e: { activityId: number }) => e.activityId === demos[0].id)).toMatchObject({ type: "activity", status: "scheduled" });

    const newAt = isoIn(2);
    expect((await call("PATCH", `/sales/opportunities/${oppId}`, { cookie: founder.cookie, body: { demoAt: newAt } })).status).toBe(200);
    const rescheduled = (await detail(founder, created.company.id)).activities.filter((a: { type: string }) => a.type === "demo");
    expect(rescheduled).toHaveLength(1);
    expect(rescheduled[0]).toMatchObject({ id: demos[0].id, scheduledAt: newAt });
  });

  it("links an already scheduled demo activity instead of creating a second one", async () => {
    const founder = await bootstrapFounder();
    const created = await createCompany(founder, { name: "Linked Demo Co", ...qualifiedFields, contacts: [{ name: "Buyer", email: "buyer@linkeddemo.in" }] });
    const companyId = created.company.id;
    const buyer = created.contacts[0]!.id;
    expect((await call("POST", `/sales/opportunities/${created.opportunity.id}/stage`, { cookie: founder.cookie, body: { to: "Qualified" } })).status).toBe(200);
    const demoAt = isoIn(1);
    const scheduled = await call("POST", "/sales/activities", { cookie: founder.cookie, body: { companyId, type: "demo", status: "scheduled", scheduledAt: demoAt, contactId: buyer } });
    expect(scheduled.status).toBe(201);
    expect((await call("POST", `/sales/opportunities/${created.opportunity.id}/stage`, {
      cookie: founder.cookie,
      body: { to: "Demo booked", evidence: { demoBuyerContactId: buyer, demoAt } },
    })).status).toBe(200);
    const demos = (await db.select().from(salesActivitiesTable).where(eq(salesActivitiesTable.companyId, companyId))).filter((a) => a.type === "demo");
    expect(demos.map((a) => a.id)).toEqual([scheduled.body.activity.id]);
  });

  it("migration 0129 backfills a scheduled demo for existing Demo booked opportunities and is safe to re-run", async () => {
    const founder = await bootstrapFounder();
    const created = await createCompany(founder, { name: "Backfill Co", contacts: [{ name: "Buyer", phone: "98450 30303" }] });
    const demoAt = new Date(Date.now() + DAY);
    await db
      .update(salesOpportunitiesTable)
      .set({ stage: "Demo booked", demoAt, demoBuyerContactId: created.contacts[0]!.id })
      .where(eq(salesOpportunitiesTable.id, created.opportunity.id));

    for (let run = 0; run < 2; run++) {
      for (const statement of salesMigrationStatements()) await testDb!.exec(statement);
    }
    const demos = (await db.select().from(salesActivitiesTable).where(eq(salesActivitiesTable.companyId, created.company.id))).filter((a) => a.type === "demo");
    expect(demos).toHaveLength(1);
    expect(demos[0]).toMatchObject({ status: "scheduled", opportunityId: created.opportunity.id, contactId: created.contacts[0]!.id });
    expect(demos[0]!.scheduledAt?.toISOString()).toBe(demoAt.toISOString());
    const d = await detail(founder, created.company.id);
    expect(d.tasks.filter((t: { dedupeKey: string }) => t.dedupeKey === `activity:${demos[0]!.id}:appointment`)).toHaveLength(1);
    expect(d.touchpoints.filter((t: { kind: string }) => t.kind === "original")).toHaveLength(1);
  });

  it("does not double count conversations when an activity is edited", async () => {
    const founder = await bootstrapFounder();
    const created = await createCompany(founder, { name: "Edit Count Co" });
    const visit = await call("POST", "/sales/activities", {
      cookie: founder.cookie,
      body: { companyId: created.company.id, type: "visit", flags: { buyerConversation: true } },
    });
    expect(visit.status).toBe(201);
    for (const notes of ["first edit", "second edit"]) {
      expect((await call("PATCH", `/sales/activities/${visit.body.activity.id}`, { cookie: founder.cookie, body: { notes, flags: { buyerConversation: true } } })).status).toBe(200);
    }
    const today = (await call("GET", `/sales/today?date=${istDate(0)}`, { cookie: founder.cookie })).body;
    expect(today.activity.actual).toMatchObject({ visits: 1, firstVisits: 1, conversations: 1 });
  });

  it("records the original source and every repeat webhook enquiry as touchpoints", async () => {
    const founder = await bootstrapFounder();
    const payload = {
      source: "website_form",
      campaign: "Diwali",
      enquiredAt: new Date().toISOString(),
      company: { name: "Touchpoint Co", website: "touchpoint.in" },
      contact: { name: "Priya", phone: "+91 98450 77777" },
    };
    const first = await signedWebhook(payload, "tp-1");
    expect(first.status).toBe(201);
    const repeat = await signedWebhook({ ...payload, campaign: "Pongal" }, "tp-2");
    expect(repeat.body).toMatchObject({ created: false, companyId: first.body.companyId });
    expect((await signedWebhook({ ...payload, campaign: "Pongal" }, "tp-2")).status).toBe(200);

    const d = await detail(founder, first.body.companyId);
    expect(d.touchpoints.map((t: { kind: string; campaign: string }) => `${t.kind}:${t.campaign}`).sort()).toEqual(["original:Diwali", "webhook:Pongal"]);
    expect(d.company).toMatchObject({ originalSource: "website_form", originalSourceCampaign: "Diwali" });
  });

  it("resolves duplicate reviews: keep separate, or founder-only merge of a fresh lead", async () => {
    const founder = await bootstrapFounder();
    const mate = await addTeammate(founder);
    const original = await createCompany(founder, { name: "Alpha Staffing", contacts: [{ name: "Ravi", phone: "98450 20202" }] });
    const keep = await createCompany(mate, { name: "Alpha Staffing Mysuru" });
    expect(keep.dedupe.needsReview).toBe(true);
    expect((await call("POST", `/sales/companies/${keep.company.id}/dedupe-review`, { cookie: mate.cookie, body: { action: "keep_separate" } })).status).toBe(200);
    expect((await detail(founder, keep.company.id)).company).toMatchObject({ needsDedupeReview: false, duplicateOfCompanyId: null });

    const dup = await createCompany(mate, { name: "Alpha Staffing Bengaluru", contacts: [{ name: "Asha", email: "asha@alpha.example" }] });
    expect((await detail(founder, dup.company.id)).duplicateOf).toMatchObject({ id: original.company.id, name: "Alpha Staffing" });
    await call("POST", "/sales/activities", { cookie: mate.cookie, body: { companyId: dup.company.id, type: "call", flags: { buyerConversation: true } } });
    expect((await call("POST", `/sales/companies/${dup.company.id}/dedupe-review`, { cookie: mate.cookie, body: { action: "merge" } })).status).toBe(403);

    const merged = await call("POST", `/sales/companies/${dup.company.id}/dedupe-review`, { cookie: founder.cookie, body: { action: "merge", reason: "Same office" } });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ action: "merge", companyId: original.company.id, moved: { contacts: 1, activities: 1 } });
    expect((await call("GET", `/sales/companies/${dup.company.id}`, { cookie: founder.cookie })).status).toBe(404);
    const target = await detail(founder, original.company.id);
    expect(target.contacts.map((c: { name: string }) => c.name).sort()).toEqual(["Asha", "Ravi"]);
    expect(target.activities).toHaveLength(1);
    expect(target.company.lastActivityAt).not.toBeNull();
    const audit = await db.select().from(salesAuditTable).where(eq(salesAuditTable.action, "dedupe_merged"));
    expect(audit).toHaveLength(1);

    const blocked = await createCompany(founder, { name: "Alpha Staffing Chennai" });
    const proposal = await call("POST", "/sales/proposals", { cookie: founder.cookie, body: { companyId: blocked.company.id, monthlyFeePaise: 2_500_000 } });
    expect(proposal.status).toBe(201);
    const refused = await call("POST", `/sales/companies/${blocked.company.id}/dedupe-review`, { cookie: founder.cookie, body: { action: "merge" } });
    expect(refused.status).toBe(409);
    expect(refused.body.blockers).toContain("proposals");
  });

  it("generates missing sprint targets from config without overwriting edits", async () => {
    const founder = await bootstrapFounder();
    const mate = await addTeammate(founder);
    const range = { from: "2027-01-01", to: "2027-01-07" };
    expect((await call("POST", "/sales/targets/generate", { cookie: mate.cookie, body: range })).status).toBe(403);

    const first = await call("POST", "/sales/targets/generate", { cookie: founder.cookie, body: range });
    expect(first.status).toBe(200);
    expect(first.body.created).toEqual({ daily: 7, milestones: 1 });
    const rows = await db.select().from(salesTargetsTable).where(eq(salesTargetsTable.kind, "daily"));
    const sunday = rows.find((r) => r.date === "2027-01-03")!;
    expect(sunday).toMatchObject({ dayType: "review", visits: 0 });
    const friday = rows.find((r) => r.date === "2027-01-01")!;
    expect(friday).toMatchObject({ dayType: "selling", visits: 16, conversations: 6 });

    await call("PATCH", `/sales/targets/${friday.id}`, { cookie: founder.cookie, body: { dayType: "delivery", visits: 12 } });
    const again = await call("POST", "/sales/targets/generate", { cookie: founder.cookie, body: range });
    expect(again.body.created).toEqual({ daily: 0, milestones: 0 });
    const [kept] = await db.select().from(salesTargetsTable).where(eq(salesTargetsTable.id, friday.id));
    expect(kept).toMatchObject({ dayType: "delivery", visits: 12 });
  });

  it("reports subscriptions that went live in the period separately from new paying companies", async () => {
    const founder = await bootstrapFounder();
    const created = await createCompany(founder, { name: "Live Report Co" });
    await db.insert(salesSubscriptionsTable).values({ companyId: created.company.id, monthlyFeePaise: 2_500_000, status: "active", liveAt: new Date(Date.now() - DAY) });
    const reports = (await call("GET", `/sales/reports?from=${istDate(-7)}&to=${istDate(0)}`, { cookie: founder.cookie })).body;
    expect(reports.newLive).toMatchObject({ count: 1, items: [{ companyId: created.company.id, name: "Live Report Co" }] });
    expect(reports.newPaidClients.count).toBe(0);
  });

  it("keeps the company next action in step with its task", async () => {
    const founder = await bootstrapFounder();
    const created = await createCompany(founder, { name: "Next Action Co", nextAction: "Call back", nextActionDueAt: isoIn(1) });
    const id = created.company.id;
    const taskOf = async () => (await detail(founder, id)).tasks.find((t: { dedupeKey: string }) => t.dedupeKey === `company:${id}:next_action`);

    const task = await taskOf();
    const later = isoIn(3);
    expect((await call("PATCH", `/sales/tasks/${task.id}`, { cookie: founder.cookie, body: { dueAt: later } })).status).toBe(200);
    expect((await detail(founder, id)).company).toMatchObject({ nextAction: "Call back", nextActionDueAt: later });

    expect((await call("POST", `/sales/tasks/${task.id}/complete`, { cookie: founder.cookie, body: { outcome: "Spoke to owner" } })).status).toBe(200);
    expect((await detail(founder, id)).company).toMatchObject({ nextAction: null, nextActionDueAt: null });
    const missing = (await call("GET", "/sales/companies?missingNextAction=1", { cookie: founder.cookie })).body;
    expect(missing.items.map((c: { id: number }) => c.id)).toContain(id);

    expect((await call("PATCH", `/sales/companies/${id}`, { cookie: founder.cookie, body: { nextAction: "Send proposal", nextActionDueAt: isoIn(2) } })).status).toBe(200);
    expect(await taskOf()).toMatchObject({ id: task.id, status: "open", title: "Send proposal", completedAt: null });
  });
});
