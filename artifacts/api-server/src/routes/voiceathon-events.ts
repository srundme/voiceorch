/**
 * Authenticated Voice-a-thon organizer + participant APIs.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  agentsTable,
  agentVersionsTable,
  usersTable,
  webcallLinksTable,
  voiceathonEventsTable,
  voiceathonTeamsTable,
  voiceathonTeamMembersTable,
  voiceathonSubmissionsTable,
  voiceathonJudgesTable,
  voiceathonJudgeAssignmentsTable,
  voiceathonScoresTable,
  voiceathonAnnouncementsTable,
  voiceathonCertificatesTable,
  type VoiceathonEventStatus,
  type VoiceathonRubricCriterion,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail } from "../services/brevo.js";
import { mintWebcallLinkToken } from "../services/webcall-links.js";
import { renderVoiceathonCertificatePdf } from "../services/voiceathon-certificate.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import {
  getOwnedEvent,
  serializeEvent,
  uniqueEventSlug,
  canTransitionStatus,
  normalizeEmail,
  mintJudgeToken,
  hashJudgeToken,
  mintCertificateCode,
  buildLeaderboard,
  findTeamByLeaderClaim,
  loadTeamWithMembers,
  isSubmissionOpen,
  countTeams,
} from "../services/voiceathon-access.js";

const router: IRouter = Router();

const Short = z.string().max(300);
const Long = z.string().max(20000);
const IsoDate = z.string().datetime().nullable().optional();

const RubricCriterion = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  maxScore: z.number().int().min(1).max(100),
  weight: z.number().min(0.1).max(100),
});

const Prize = z.object({
  place: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

const Faq = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(5000),
});

const CreateEventBody = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().max(128).regex(/^[a-z0-9][a-z0-9-]*$/i).optional(),
  tagline: Short.nullable().optional(),
  description: Long.nullable().optional(),
  bannerUrl: z.string().url().max(1000).nullable().optional(),
  mode: z.enum(["online", "offline", "hybrid"]).optional(),
  venue: Short.nullable().optional(),
  timezone: z.string().max(80).optional(),
  registrationOpensAt: IsoDate,
  registrationClosesAt: IsoDate,
  eventStartsAt: IsoDate,
  eventEndsAt: IsoDate,
  submissionOpensAt: IsoDate,
  submissionClosesAt: IsoDate,
  judgingOpensAt: IsoDate,
  judgingClosesAt: IsoDate,
  minTeamSize: z.number().int().min(1).max(20).optional(),
  maxTeamSize: z.number().int().min(1).max(20).optional(),
  maxTeams: z.number().int().min(1).max(10000).nullable().optional(),
  rules: Long.nullable().optional(),
  eligibility: Long.nullable().optional(),
  prizes: z.array(Prize).max(20).optional(),
  faq: z.array(Faq).max(50).optional(),
  rubric: z.array(RubricCriterion).max(20).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

const UpdateEventBody = CreateEventBody.partial().extend({
  status: z.enum([
    "draft", "published", "registration_closed", "submission_closed", "judging", "completed", "archived",
  ]).optional(),
  leaderboardPublished: z.boolean().optional(),
});

function parseDate(v: string | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function defaultRubric(): VoiceathonRubricCriterion[] {
  return [
    { id: "voice_quality", label: "Voice quality & naturalness", maxScore: 10, weight: 1 },
    { id: "conversation", label: "Conversation design", maxScore: 10, weight: 1.5 },
    { id: "usefulness", label: "Usefulness of the agent", maxScore: 10, weight: 1.5 },
    { id: "innovation", label: "Innovation", maxScore: 10, weight: 1 },
    { id: "demo", label: "Live demo reliability", maxScore: 10, weight: 1 },
  ];
}

// ── Event CRUD ───────────────────────────────────────────────────────────────

router.get("/voiceathon/events", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db
    .select()
    .from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.userId, clerkId))
    .orderBy(desc(voiceathonEventsTable.updatedAt));
  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db
      .select({ eventId: voiceathonTeamsTable.eventId, c: count() })
      .from(voiceathonTeamsTable)
      .where(inArray(voiceathonTeamsTable.eventId, ids))
      .groupBy(voiceathonTeamsTable.eventId)
    : [];
  const countMap = new Map(counts.map((c) => [c.eventId, Number(c.c)]));
  res.json(rows.map((ev) => serializeEvent(ev, { teamCount: countMap.get(ev.id) ?? 0 })));
});

router.post("/voiceathon/events", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  if ((b.minTeamSize ?? 1) > (b.maxTeamSize ?? 4)) {
    res.status(400).json({ error: "minTeamSize cannot exceed maxTeamSize" });
    return;
  }
  try {
    const slug = await uniqueEventSlug(b.slug || b.title);
    const [row] = await db.insert(voiceathonEventsTable).values({
      userId: clerkId,
      slug,
      title: b.title.trim(),
      tagline: b.tagline ?? null,
      description: b.description ?? null,
      bannerUrl: b.bannerUrl ?? null,
      mode: b.mode ?? "online",
      venue: b.venue ?? null,
      timezone: b.timezone ?? "Asia/Kolkata",
      status: b.status === "published" ? "published" : "draft",
      registrationOpensAt: parseDate(b.registrationOpensAt ?? null),
      registrationClosesAt: parseDate(b.registrationClosesAt ?? null),
      eventStartsAt: parseDate(b.eventStartsAt ?? null),
      eventEndsAt: parseDate(b.eventEndsAt ?? null),
      submissionOpensAt: parseDate(b.submissionOpensAt ?? null),
      submissionClosesAt: parseDate(b.submissionClosesAt ?? null),
      judgingOpensAt: parseDate(b.judgingOpensAt ?? null),
      judgingClosesAt: parseDate(b.judgingClosesAt ?? null),
      minTeamSize: b.minTeamSize ?? 1,
      maxTeamSize: b.maxTeamSize ?? 4,
      maxTeams: b.maxTeams ?? null,
      rules: b.rules ?? null,
      eligibility: b.eligibility ?? null,
      prizes: b.prizes ?? [],
      faq: b.faq ?? [],
      rubric: b.rubric?.length ? b.rubric : defaultRubric(),
    }).returning();
    res.status(201).json(serializeEvent(row!, { teamCount: 0 }));
  } catch (err) {
    logger.error({ err }, "create voiceathon event failed");
    res.status(500).json({ error: "Failed to create event" });
  }
});

router.get("/voiceathon/events/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }
  const teamCount = await countTeams(id);
  res.json(serializeEvent(ev, { teamCount }));
});

router.patch("/voiceathon/events/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }
  const parsed = UpdateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  if (b.status && b.status !== ev.status && !canTransitionStatus(ev.status, b.status as VoiceathonEventStatus)) {
    res.status(400).json({ error: `Cannot transition from ${ev.status} to ${b.status}` });
    return;
  }
  const minSize = b.minTeamSize ?? ev.minTeamSize;
  const maxSize = b.maxTeamSize ?? ev.maxTeamSize;
  if (minSize > maxSize) {
    res.status(400).json({ error: "minTeamSize cannot exceed maxTeamSize" });
    return;
  }

  const set: Record<string, unknown> = {};
  if (b.title !== undefined) set["title"] = b.title.trim();
  if (b.tagline !== undefined) set["tagline"] = b.tagline;
  if (b.description !== undefined) set["description"] = b.description;
  if (b.bannerUrl !== undefined) set["bannerUrl"] = b.bannerUrl;
  if (b.mode !== undefined) set["mode"] = b.mode;
  if (b.venue !== undefined) set["venue"] = b.venue;
  if (b.timezone !== undefined) set["timezone"] = b.timezone;
  if (b.status !== undefined) set["status"] = b.status;
  if (b.leaderboardPublished !== undefined) set["leaderboardPublished"] = b.leaderboardPublished;
  if (b.registrationOpensAt !== undefined) set["registrationOpensAt"] = parseDate(b.registrationOpensAt);
  if (b.registrationClosesAt !== undefined) set["registrationClosesAt"] = parseDate(b.registrationClosesAt);
  if (b.eventStartsAt !== undefined) set["eventStartsAt"] = parseDate(b.eventStartsAt);
  if (b.eventEndsAt !== undefined) set["eventEndsAt"] = parseDate(b.eventEndsAt);
  if (b.submissionOpensAt !== undefined) set["submissionOpensAt"] = parseDate(b.submissionOpensAt);
  if (b.submissionClosesAt !== undefined) set["submissionClosesAt"] = parseDate(b.submissionClosesAt);
  if (b.judgingOpensAt !== undefined) set["judgingOpensAt"] = parseDate(b.judgingOpensAt);
  if (b.judgingClosesAt !== undefined) set["judgingClosesAt"] = parseDate(b.judgingClosesAt);
  if (b.minTeamSize !== undefined) set["minTeamSize"] = b.minTeamSize;
  if (b.maxTeamSize !== undefined) set["maxTeamSize"] = b.maxTeamSize;
  if (b.maxTeams !== undefined) set["maxTeams"] = b.maxTeams;
  if (b.rules !== undefined) set["rules"] = b.rules;
  if (b.eligibility !== undefined) set["eligibility"] = b.eligibility;
  if (b.prizes !== undefined) set["prizes"] = b.prizes;
  if (b.faq !== undefined) set["faq"] = b.faq;
  if (b.rubric !== undefined) set["rubric"] = b.rubric;
  if (b.slug) set["slug"] = await uniqueEventSlug(b.slug, id);

  if (!Object.keys(set).length) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [row] = await db.update(voiceathonEventsTable).set(set)
    .where(eq(voiceathonEventsTable.id, id)).returning();
  const teamCount = await countTeams(id);
  res.json(serializeEvent(row!, { teamCount }));
});

router.delete("/voiceathon/events/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(voiceathonEventsTable)
    .where(and(eq(voiceathonEventsTable.id, id), eq(voiceathonEventsTable.userId, clerkId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Event not found" }); return; }
  res.sendStatus(204);
});

// ── Teams / registrations ────────────────────────────────────────────────────

router.get("/voiceathon/events/:id/teams", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const teams = await db.select().from(voiceathonTeamsTable)
    .where(eq(voiceathonTeamsTable.eventId, id))
    .orderBy(desc(voiceathonTeamsTable.createdAt));
  const teamIds = teams.map((t) => t.id);
  const members = teamIds.length
    ? await db.select().from(voiceathonTeamMembersTable)
      .where(inArray(voiceathonTeamMembersTable.teamId, teamIds))
      .orderBy(asc(voiceathonTeamMembersTable.sortOrder))
    : [];
  const subs = teamIds.length
    ? await db.select().from(voiceathonSubmissionsTable)
      .where(inArray(voiceathonSubmissionsTable.teamId, teamIds))
    : [];
  const membersByTeam = new Map<number, typeof members>();
  for (const m of members) {
    const arr = membersByTeam.get(m.teamId) ?? [];
    arr.push(m);
    membersByTeam.set(m.teamId, arr);
  }
  const subByTeam = new Map(subs.map((s) => [s.teamId, s]));

  res.json(teams.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    claimedAt: t.claimedAt?.toISOString() ?? null,
    members: membersByTeam.get(t.id) ?? [],
    submission: subByTeam.get(t.id)
      ? {
          id: subByTeam.get(t.id)!.id,
          status: subByTeam.get(t.id)!.status,
          agentId: subByTeam.get(t.id)!.agentId,
          projectTitle: subByTeam.get(t.id)!.projectTitle,
          submittedAt: subByTeam.get(t.id)!.submittedAt?.toISOString() ?? null,
        }
      : null,
  })));
});

router.patch("/voiceathon/events/:id/teams/:teamId", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const teamId = parseInt(String(req.params["teamId"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const body = z.object({
    status: z.enum(["registered", "claimed", "submitted", "disqualified", "withdrawn"]).optional(),
    placement: z.enum(["participant", "finalist", "winner", "runner_up"]).optional(),
    notes: z.string().max(5000).nullable().optional(),
  }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid body", details: body.error.flatten() });
    return;
  }

  const [existing] = await db.select().from(voiceathonTeamsTable)
    .where(and(eq(voiceathonTeamsTable.id, teamId), eq(voiceathonTeamsTable.eventId, id)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Team not found" }); return; }

  const set: Record<string, unknown> = {};
  if (body.data.status !== undefined) set["status"] = body.data.status;
  if (body.data.placement !== undefined) set["placement"] = body.data.placement;
  if (body.data.notes !== undefined) set["notes"] = body.data.notes;

  const [row] = await db.update(voiceathonTeamsTable).set(set)
    .where(eq(voiceathonTeamsTable.id, teamId)).returning();
  res.json(row);
});

router.get("/voiceathon/events/:id/teams/export.csv", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const teams = await db.select().from(voiceathonTeamsTable)
    .where(eq(voiceathonTeamsTable.eventId, id))
    .orderBy(asc(voiceathonTeamsTable.id));
  const teamIds = teams.map((t) => t.id);
  const members = teamIds.length
    ? await db.select().from(voiceathonTeamMembersTable)
      .where(inArray(voiceathonTeamMembersTable.teamId, teamIds))
    : [];
  const membersByTeam = new Map<number, typeof members>();
  for (const m of members) {
    const arr = membersByTeam.get(m.teamId) ?? [];
    arr.push(m);
    membersByTeam.set(m.teamId, arr);
  }

  const escape = (v: string | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    "reference,team_name,institution,city,leader_name,leader_email,leader_phone,status,placement,members,registered_at",
  ];
  for (const t of teams) {
    const mems = (membersByTeam.get(t.id) ?? [])
      .map((m) => `${m.name}${m.email ? `<${m.email}>` : ""}`)
      .join("; ");
    lines.push([
      escape(t.referenceCode),
      escape(t.name),
      escape(t.institution),
      escape(t.city),
      escape(t.leaderName),
      escape(t.leaderEmail),
      escape(t.leaderPhone),
      escape(t.status),
      escape(t.placement),
      escape(mems),
      escape(t.createdAt.toISOString()),
    ].join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="voiceathon-${ev.slug}-teams.csv"`);
  res.send(lines.join("\n"));
});

// ── Submissions (organizer view) ─────────────────────────────────────────────

router.get("/voiceathon/events/:id/submissions", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const rows = await db.select({
    submission: voiceathonSubmissionsTable,
    teamName: voiceathonTeamsTable.name,
    teamReference: voiceathonTeamsTable.referenceCode,
    agentName: agentsTable.name,
    webcallToken: webcallLinksTable.token,
  })
    .from(voiceathonSubmissionsTable)
    .innerJoin(voiceathonTeamsTable, eq(voiceathonSubmissionsTable.teamId, voiceathonTeamsTable.id))
    .leftJoin(agentsTable, eq(voiceathonSubmissionsTable.agentId, agentsTable.id))
    .leftJoin(webcallLinksTable, eq(voiceathonSubmissionsTable.webcallLinkId, webcallLinksTable.id))
    .where(eq(voiceathonSubmissionsTable.eventId, id))
    .orderBy(desc(voiceathonSubmissionsTable.submittedAt));

  res.json(rows.map((r) => ({
    ...r.submission,
    teamName: r.teamName,
    teamReference: r.teamReference,
    agentName: r.agentName,
    judgeJoinUrl: r.webcallToken ? `/join/${r.webcallToken}` : null,
    submittedAt: r.submission.submittedAt?.toISOString() ?? null,
    createdAt: r.submission.createdAt.toISOString(),
    updatedAt: r.submission.updatedAt.toISOString(),
  })));
});

// ── Judges ───────────────────────────────────────────────────────────────────

router.get("/voiceathon/events/:id/judges", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const judges = await db.select().from(voiceathonJudgesTable)
    .where(eq(voiceathonJudgesTable.eventId, id))
    .orderBy(desc(voiceathonJudgesTable.createdAt));
  const assignments = await db.select().from(voiceathonJudgeAssignmentsTable)
    .where(eq(voiceathonJudgeAssignmentsTable.eventId, id));
  const assignCount = new Map<number, number>();
  for (const a of assignments) {
    assignCount.set(a.judgeId, (assignCount.get(a.judgeId) ?? 0) + 1);
  }

  res.json(judges.map((j) => ({
    id: j.id,
    name: j.name,
    email: j.email,
    status: j.status,
    assignmentCount: assignCount.get(j.id) ?? 0,
    invitedAt: j.invitedAt.toISOString(),
    lastAccessAt: j.lastAccessAt?.toISOString() ?? null,
  })));
});

router.post("/voiceathon/events/:id/judges", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const parsed = z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(320),
    submissionIds: z.array(z.number().int().positive()).max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  const emailNorm = normalizeEmail(parsed.data.email);
  const token = mintJudgeToken();
  const tokenHash = hashJudgeToken(token);

  try {
    const [judge] = await db.insert(voiceathonJudgesTable).values({
      eventId: id,
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim(),
      emailNormalized: emailNorm,
      tokenHash,
      status: "invited",
    }).returning();

    if (parsed.data.submissionIds?.length) {
      const validSubs = await db.select({ id: voiceathonSubmissionsTable.id })
        .from(voiceathonSubmissionsTable)
        .where(and(
          eq(voiceathonSubmissionsTable.eventId, id),
          inArray(voiceathonSubmissionsTable.id, parsed.data.submissionIds),
          eq(voiceathonSubmissionsTable.status, "submitted"),
        ));
      if (validSubs.length) {
        await db.insert(voiceathonJudgeAssignmentsTable).values(
          validSubs.map((s) => ({
            eventId: id,
            judgeId: judge!.id,
            submissionId: s.id,
          })),
        );
      }
    }

    const base = getSelfBaseUrl().replace(/\/$/, "");
    const inviteUrl = `${base}/events/judge/${token}`;

    try {
      await sendBrevoEmail(
        judge!.email,
        `You're invited to judge ${ev.title}`,
        `<p>Hi ${judge!.name},</p>
         <p>You've been invited to judge <strong>${ev.title}</strong>.</p>
         <p><a href="${inviteUrl}">Open your judging portal</a></p>
         <p>Keep this link private — it is your access credential.</p>`,
        undefined,
        { emailType: "voiceathon_judge_invite", toName: judge!.name },
      );
    } catch (mailErr) {
      logger.warn({ err: mailErr, judgeId: judge!.id }, "Judge invite email failed");
    }

    res.status(201).json({
      id: judge!.id,
      name: judge!.name,
      email: judge!.email,
      status: judge!.status,
      inviteUrl,
    });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("unique") || err?.code === "23505") {
      res.status(409).json({ error: "A judge with this email already exists for the event" });
      return;
    }
    logger.error({ err }, "create judge failed");
    res.status(500).json({ error: "Failed to invite judge" });
  }
});

router.post("/voiceathon/events/:id/judges/:judgeId/assign", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const judgeId = parseInt(String(req.params["judgeId"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const parsed = z.object({
    submissionIds: z.array(z.number().int().positive()).min(1).max(500),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const [judge] = await db.select().from(voiceathonJudgesTable)
    .where(and(eq(voiceathonJudgesTable.id, judgeId), eq(voiceathonJudgesTable.eventId, id)))
    .limit(1);
  if (!judge) { res.status(404).json({ error: "Judge not found" }); return; }

  const validSubs = await db.select({ id: voiceathonSubmissionsTable.id })
    .from(voiceathonSubmissionsTable)
    .where(and(
      eq(voiceathonSubmissionsTable.eventId, id),
      inArray(voiceathonSubmissionsTable.id, parsed.data.submissionIds),
      eq(voiceathonSubmissionsTable.status, "submitted"),
    ));

  await db.delete(voiceathonJudgeAssignmentsTable)
    .where(eq(voiceathonJudgeAssignmentsTable.judgeId, judgeId));
  if (validSubs.length) {
    await db.insert(voiceathonJudgeAssignmentsTable).values(
      validSubs.map((s) => ({ eventId: id, judgeId, submissionId: s.id })),
    );
  }
  res.json({ ok: true, assigned: validSubs.length });
});

router.post("/voiceathon/events/:id/judges/:judgeId/revoke", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const judgeId = parseInt(String(req.params["judgeId"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const [row] = await db.update(voiceathonJudgesTable)
    .set({ status: "revoked", tokenHash: hashJudgeToken(mintJudgeToken()) })
    .where(and(eq(voiceathonJudgesTable.id, judgeId), eq(voiceathonJudgesTable.eventId, id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Judge not found" }); return; }
  res.json({ ok: true });
});

// ── Results / leaderboard ────────────────────────────────────────────────────

router.get("/voiceathon/events/:id/leaderboard", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }
  res.json({
    published: ev.leaderboardPublished,
    rows: await buildLeaderboard(id),
  });
});

router.get("/voiceathon/events/:id/scores", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const scores = await db.select({
    score: voiceathonScoresTable,
    judgeName: voiceathonJudgesTable.name,
    teamName: voiceathonTeamsTable.name,
  })
    .from(voiceathonScoresTable)
    .innerJoin(voiceathonJudgesTable, eq(voiceathonScoresTable.judgeId, voiceathonJudgesTable.id))
    .innerJoin(voiceathonTeamsTable, eq(voiceathonScoresTable.teamId, voiceathonTeamsTable.id))
    .where(eq(voiceathonScoresTable.eventId, id))
    .orderBy(desc(voiceathonScoresTable.updatedAt));

  res.json(scores.map((r) => ({
    ...r.score,
    judgeName: r.judgeName,
    teamName: r.teamName,
    finalizedAt: r.score.finalizedAt?.toISOString() ?? null,
    createdAt: r.score.createdAt.toISOString(),
    updatedAt: r.score.updatedAt.toISOString(),
  })));
});

// ── Announcements ────────────────────────────────────────────────────────────

router.get("/voiceathon/events/:id/announcements", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }
  const rows = await db.select().from(voiceathonAnnouncementsTable)
    .where(eq(voiceathonAnnouncementsTable.eventId, id))
    .orderBy(desc(voiceathonAnnouncementsTable.createdAt));
  res.json(rows.map((r) => ({
    ...r,
    sentAt: r.sentAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })));
});

router.post("/voiceathon/events/:id/announcements", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const parsed = z.object({
    subject: z.string().min(1).max(200),
    bodyHtml: z.string().min(1).max(50000),
    audience: z.enum(["all_teams", "leaders", "finalists", "winners"]).default("all_teams"),
    send: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  const [ann] = await db.insert(voiceathonAnnouncementsTable).values({
    eventId: id,
    subject: parsed.data.subject.trim(),
    bodyHtml: parsed.data.bodyHtml,
    audience: parsed.data.audience,
    status: "draft",
    createdByUserId: clerkId,
  }).returning();

  if (!parsed.data.send) {
    res.status(201).json(ann);
    return;
  }

  // Resolve recipients
  let teams = await db.select().from(voiceathonTeamsTable)
    .where(eq(voiceathonTeamsTable.eventId, id));
  if (parsed.data.audience === "finalists") {
    teams = teams.filter((t) => t.placement === "finalist" || t.placement === "winner" || t.placement === "runner_up");
  } else if (parsed.data.audience === "winners") {
    teams = teams.filter((t) => t.placement === "winner" || t.placement === "runner_up");
  }
  teams = teams.filter((t) => t.status !== "disqualified" && t.status !== "withdrawn");

  let sent = 0;
  let failed = 0;
  await db.update(voiceathonAnnouncementsTable)
    .set({ status: "sending", recipientCount: teams.length })
    .where(eq(voiceathonAnnouncementsTable.id, ann!.id));

  for (const t of teams) {
    try {
      await sendBrevoEmail(
        t.leaderEmail,
        parsed.data.subject,
        parsed.data.bodyHtml,
        undefined,
        { emailType: "voiceathon_announcement", toName: t.leaderName },
      );
      sent++;
    } catch {
      failed++;
    }
  }

  const [updated] = await db.update(voiceathonAnnouncementsTable).set({
    status: failed && !sent ? "failed" : "sent",
    sentCount: sent,
    failedCount: failed,
    sentAt: new Date(),
  }).where(eq(voiceathonAnnouncementsTable.id, ann!.id)).returning();

  res.status(201).json(updated);
});

// ── Certificates ─────────────────────────────────────────────────────────────

router.get("/voiceathon/events/:id/certificates", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }
  const rows = await db.select().from(voiceathonCertificatesTable)
    .where(eq(voiceathonCertificatesTable.eventId, id))
    .orderBy(desc(voiceathonCertificatesTable.issuedAt));
  res.json(rows.map((r) => ({
    ...r,
    issuedAt: r.issuedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    verifyUrl: `/events/certificates/${r.verificationCode}/verify`,
  })));
});

router.post("/voiceathon/events/:id/certificates/issue", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const ev = await getOwnedEvent(id, clerkId);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const parsed = z.object({
    type: z.enum(["participation", "finalist", "winner", "runner_up"]).default("participation"),
    teamIds: z.array(z.number().int().positive()).optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  let teams = await db.select().from(voiceathonTeamsTable)
    .where(eq(voiceathonTeamsTable.eventId, id));
  if (parsed.data.teamIds?.length) {
    teams = teams.filter((t) => parsed.data.teamIds!.includes(t.id));
  } else if (parsed.data.type === "finalist") {
    teams = teams.filter((t) => ["finalist", "winner", "runner_up"].includes(t.placement));
  } else if (parsed.data.type === "winner") {
    teams = teams.filter((t) => t.placement === "winner");
  } else if (parsed.data.type === "runner_up") {
    teams = teams.filter((t) => t.placement === "runner_up");
  }
  teams = teams.filter((t) => t.status !== "disqualified" && t.status !== "withdrawn");

  const teamIds = teams.map((t) => t.id);
  const members = teamIds.length
    ? await db.select().from(voiceathonTeamMembersTable)
      .where(inArray(voiceathonTeamMembersTable.teamId, teamIds))
    : [];

  let issued = 0;
  for (const m of members) {
    const team = teams.find((t) => t.id === m.teamId);
    if (!team) continue;
    try {
      await db.insert(voiceathonCertificatesTable).values({
        eventId: id,
        teamId: team.id,
        memberId: m.id,
        type: parsed.data.type,
        verificationCode: mintCertificateCode(),
        recipientName: m.name,
        teamName: team.name,
      });
      issued++;
    } catch (err) {
      // Unique (member, type) — already issued
      logger.warn({ err, memberId: m.id }, "certificate issue skipped");
    }
  }

  res.json({ ok: true, issued });
});

router.get("/voiceathon/certificates/:id/pdf", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const certId = parseInt(String(req.params["id"]), 10);
  const [cert] = await db.select().from(voiceathonCertificatesTable)
    .where(eq(voiceathonCertificatesTable.id, certId)).limit(1);
  if (!cert) { res.status(404).json({ error: "Certificate not found" }); return; }
  const ev = await getOwnedEvent(cert.eventId, clerkId);
  if (!ev) {
    // Also allow the claiming team leader to download
    const [user] = await db.select({ email: usersTable.email }).from(usersTable)
      .where(eq(usersTable.clerkId, clerkId)).limit(1);
    const [team] = await db.select().from(voiceathonTeamsTable)
      .where(eq(voiceathonTeamsTable.id, cert.teamId)).limit(1);
    const emailOk = user?.email && team
      && (team.claimedByUserId === clerkId || normalizeEmail(user.email) === team.leaderEmailNormalized);
    if (!emailOk) { res.status(404).json({ error: "Certificate not found" }); return; }
  }

  const eventRow = ev ?? (await db.select().from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.id, cert.eventId)).limit(1))[0];
  if (!eventRow) { res.status(404).json({ error: "Event not found" }); return; }

  const pdf = await renderVoiceathonCertificatePdf({
    eventTitle: eventRow.title,
    recipientName: cert.recipientName,
    teamName: cert.teamName,
    type: cert.type,
    verificationCode: cert.verificationCode,
    issuedAt: cert.issuedAt,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="certificate-${cert.verificationCode}.pdf"`);
  res.send(pdf);
});

// ── Participant: my team for an event ────────────────────────────────────────

router.get("/voiceathon/events/:id/my-team", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [ev] = await db.select().from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.id, id)).limit(1);
  if (!ev || ev.status === "draft" || ev.status === "archived") {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.clerkId, clerkId)).limit(1);
  if (!user?.email) {
    res.status(400).json({ error: "Your account needs an email to claim a team registration" });
    return;
  }

  const emailNorm = normalizeEmail(user.email);
  let team = await findTeamByLeaderClaim(id, clerkId, emailNorm);
  if (!team) {
    res.status(404).json({ error: "No registration found for your email on this event" });
    return;
  }

  // Claim on first access
  if (!team.claimedByUserId) {
    if (team.leaderEmailNormalized !== emailNorm) {
      res.status(403).json({ error: "Only the registered team leader can claim this team" });
      return;
    }
    const [claimed] = await db.update(voiceathonTeamsTable).set({
      claimedByUserId: clerkId,
      claimedAt: new Date(),
      status: team.status === "registered" ? "claimed" : team.status,
    }).where(eq(voiceathonTeamsTable.id, team.id)).returning();
    team = claimed!;
  } else if (team.claimedByUserId !== clerkId) {
    res.status(403).json({ error: "This team is claimed by another account" });
    return;
  }

  const loaded = await loadTeamWithMembers(team.id);
  const [sub] = await db.select().from(voiceathonSubmissionsTable)
    .where(eq(voiceathonSubmissionsTable.teamId, team.id)).limit(1);

  let agentName: string | null = null;
  let joinUrl: string | null = null;
  if (sub?.agentId) {
    const [ag] = await db.select({ name: agentsTable.name }).from(agentsTable)
      .where(eq(agentsTable.id, sub.agentId)).limit(1);
    agentName = ag?.name ?? null;
  }
  if (sub?.webcallLinkId) {
    const [link] = await db.select({ token: webcallLinksTable.token }).from(webcallLinksTable)
      .where(eq(webcallLinksTable.id, sub.webcallLinkId)).limit(1);
    if (link) joinUrl = `/join/${link.token}`;
  }

  res.json({
    event: serializeEvent(ev),
    team: {
      ...team,
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString(),
      claimedAt: team.claimedAt?.toISOString() ?? null,
      members: loaded?.members ?? [],
    },
    submission: sub
      ? {
          id: sub.id,
          status: sub.status,
          agentId: sub.agentId,
          agentName,
          projectTitle: sub.projectTitle,
          projectSummary: sub.projectSummary,
          judgeJoinUrl: joinUrl,
          submittedAt: sub.submittedAt?.toISOString() ?? null,
        }
      : null,
    submissionOpen: isSubmissionOpen(ev),
  });
});

router.patch("/voiceathon/events/:id/my-team", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [ev] = await db.select().from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.id, id)).limit(1);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const [team] = await db.select().from(voiceathonTeamsTable)
    .where(and(eq(voiceathonTeamsTable.eventId, id), eq(voiceathonTeamsTable.claimedByUserId, clerkId)))
    .limit(1);
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (ev.status === "completed" || ev.status === "archived") {
    res.status(403).json({ error: "Event is closed for edits" });
    return;
  }

  const parsed = z.object({
    name: z.string().min(1).max(200).optional(),
    institution: z.string().max(200).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    leaderPhone: z.string().max(40).nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const set: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) set["name"] = parsed.data.name.trim();
  if (parsed.data.institution !== undefined) set["institution"] = parsed.data.institution;
  if (parsed.data.city !== undefined) set["city"] = parsed.data.city;
  if (parsed.data.leaderPhone !== undefined) set["leaderPhone"] = parsed.data.leaderPhone;

  const [updated] = await db.update(voiceathonTeamsTable).set(set)
    .where(eq(voiceathonTeamsTable.id, team.id)).returning();
  res.json(updated);
});

router.post("/voiceathon/events/:id/my-team/submit", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [ev] = await db.select().from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.id, id)).limit(1);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }
  if (!isSubmissionOpen(ev)) {
    res.status(403).json({ error: "Submissions are closed for this event" });
    return;
  }

  const [team] = await db.select().from(voiceathonTeamsTable)
    .where(and(eq(voiceathonTeamsTable.eventId, id), eq(voiceathonTeamsTable.claimedByUserId, clerkId)))
    .limit(1);
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.status === "disqualified" || team.status === "withdrawn") {
    res.status(403).json({ error: "This team cannot submit" });
    return;
  }

  const parsed = z.object({
    agentId: z.number().int().positive(),
    projectTitle: z.string().min(1).max(200),
    projectSummary: z.string().min(1).max(5000),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  const [agent] = await db.select().from(agentsTable)
    .where(and(eq(agentsTable.id, parsed.data.agentId), eq(agentsTable.userId, clerkId)))
    .limit(1);
  if (!agent) {
    res.status(404).json({ error: "Agent not found — you can only submit an agent you own" });
    return;
  }

  // Freeze an immutable version snapshot for judging
  const [{ cnt }] = await db.select({ cnt: count() }).from(agentVersionsTable)
    .where(eq(agentVersionsTable.agentId, agent.id));
  const [version] = await db.insert(agentVersionsTable).values({
    agentId: agent.id,
    userId: clerkId,
    versionNumber: `v${Number(cnt) + 1}-voiceathon`,
    versionName: `Voice-a-thon: ${ev.title}`.slice(0, 120),
    commitDescription: `Frozen submission for ${ev.slug}`,
    status: "published",
    snapshotType: "published",
    snapshot: { ...agent },
    publishedBy: clerkId,
  }).returning();

  // Mint a dedicated judge webcall link
  const [link] = await db.insert(webcallLinksTable).values({
    agentId: agent.id,
    userId: clerkId,
    token: mintWebcallLinkToken(),
    label: `Voice-a-thon judge — ${team.name}`.slice(0, 120),
    purpose: `Judging ${ev.title}`,
    active: true,
    requireCamera: false,
    expiresAt: ev.judgingClosesAt ?? ev.eventEndsAt ?? null,
  }).returning();

  const [existing] = await db.select().from(voiceathonSubmissionsTable)
    .where(eq(voiceathonSubmissionsTable.teamId, team.id)).limit(1);

  let submission;
  if (existing) {
    if (existing.status === "submitted") {
      // Allow resubmit only while window open — overwrite freeze
    }
    const [upd] = await db.update(voiceathonSubmissionsTable).set({
      agentId: agent.id,
      agentVersionId: version!.id,
      webcallLinkId: link!.id,
      projectTitle: parsed.data.projectTitle.trim(),
      projectSummary: parsed.data.projectSummary.trim(),
      status: "submitted",
      submittedAt: new Date(),
      submittedByUserId: clerkId,
    }).where(eq(voiceathonSubmissionsTable.id, existing.id)).returning();
    submission = upd;
  } else {
    const [ins] = await db.insert(voiceathonSubmissionsTable).values({
      eventId: id,
      teamId: team.id,
      agentId: agent.id,
      agentVersionId: version!.id,
      webcallLinkId: link!.id,
      projectTitle: parsed.data.projectTitle.trim(),
      projectSummary: parsed.data.projectSummary.trim(),
      status: "submitted",
      submittedAt: new Date(),
      submittedByUserId: clerkId,
    }).returning();
    submission = ins;
  }

  await db.update(voiceathonTeamsTable)
    .set({ status: "submitted" })
    .where(eq(voiceathonTeamsTable.id, team.id));

  res.json({
    ok: true,
    submission: {
      id: submission!.id,
      status: submission!.status,
      agentId: agent.id,
      agentName: agent.name,
      projectTitle: submission!.projectTitle,
      judgeJoinUrl: `/join/${link!.token}`,
      submittedAt: submission!.submittedAt?.toISOString() ?? null,
    },
  });
});

// List events the current user can claim / has claimed (participant discovery)
router.get("/voiceathon/my-events", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [user] = await db.select().from(usersTable)
    .where(eq(usersTable.clerkId, clerkId)).limit(1);
  if (!user?.email) { res.json([]); return; }
  const emailNorm = normalizeEmail(user.email);

  const claimed = await db.select({
    team: voiceathonTeamsTable,
    event: voiceathonEventsTable,
  })
    .from(voiceathonTeamsTable)
    .innerJoin(voiceathonEventsTable, eq(voiceathonTeamsTable.eventId, voiceathonEventsTable.id))
    .where(eq(voiceathonTeamsTable.claimedByUserId, clerkId));

  const unclaimed = await db.select({
    team: voiceathonTeamsTable,
    event: voiceathonEventsTable,
  })
    .from(voiceathonTeamsTable)
    .innerJoin(voiceathonEventsTable, eq(voiceathonTeamsTable.eventId, voiceathonEventsTable.id))
    .where(and(
      eq(voiceathonTeamsTable.leaderEmailNormalized, emailNorm),
      isNull(voiceathonTeamsTable.claimedByUserId),
    ));

  const seen = new Set<number>();
  const out = [];
  for (const r of [...claimed, ...unclaimed]) {
    if (seen.has(r.event.id)) continue;
    seen.add(r.event.id);
    out.push({
      event: serializeEvent(r.event),
      teamReference: r.team.referenceCode,
      teamName: r.team.name,
      claimed: !!r.team.claimedByUserId,
      teamStatus: r.team.status,
    });
  }
  res.json(out);
});

export default router;
