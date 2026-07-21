/**
 * Admin — Voice-a-thon oversight.
 *
 * Read-only visibility into every Voice-a-thon event across all organizers:
 * events with owner + counts, and per-event teams/submissions/judges/leaderboard.
 * Gated by requireAdmin (x-admin-token). Mounted before `provisionUser`.
 */
import { Router, type IRouter } from "express";
import { eq, desc, inArray, asc } from "drizzle-orm";
import {
  db,
  usersTable,
  agentsTable,
  voiceathonEventsTable,
  voiceathonTeamsTable,
  voiceathonTeamMembersTable,
  voiceathonSubmissionsTable,
  voiceathonJudgesTable,
  voiceathonJudgeAssignmentsTable,
  voiceathonScoresTable,
  voiceathonCertificatesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { serializeEvent } from "../services/voiceathon-rules.js";
import { buildLeaderboard } from "../services/voiceathon-access.js";

const router: IRouter = Router();
router.use("/admin/voiceathon", requireAdmin);

router.get("/admin/voiceathon/events", async (_req, res): Promise<void> => {
  const events = await db.select().from(voiceathonEventsTable)
    .orderBy(desc(voiceathonEventsTable.updatedAt));
  const ids = events.map((e) => e.id);
  const ownerIds = [...new Set(events.map((e) => e.userId))];

  const owners = ownerIds.length
    ? await db.select({ clerkId: usersTable.clerkId, email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.clerkId, ownerIds))
    : [];
  const ownerById = new Map(owners.map((o) => [o.clerkId, o]));

  const teams = ids.length
    ? await db.select({ id: voiceathonTeamsTable.id, eventId: voiceathonTeamsTable.eventId })
      .from(voiceathonTeamsTable)
      .where(inArray(voiceathonTeamsTable.eventId, ids))
    : [];
  const subs = ids.length
    ? await db.select({ id: voiceathonSubmissionsTable.id, eventId: voiceathonSubmissionsTable.eventId, status: voiceathonSubmissionsTable.status })
      .from(voiceathonSubmissionsTable)
      .where(inArray(voiceathonSubmissionsTable.eventId, ids))
    : [];
  const judges = ids.length
    ? await db.select({ id: voiceathonJudgesTable.id, eventId: voiceathonJudgesTable.eventId })
      .from(voiceathonJudgesTable)
      .where(inArray(voiceathonJudgesTable.eventId, ids))
    : [];
  const certs = ids.length
    ? await db.select({ id: voiceathonCertificatesTable.id, eventId: voiceathonCertificatesTable.eventId })
      .from(voiceathonCertificatesTable)
      .where(inArray(voiceathonCertificatesTable.eventId, ids))
    : [];

  const countBy = <T extends { eventId: number }>(rows: T[]) => {
    const m = new Map<number, number>();
    for (const r of rows) m.set(r.eventId, (m.get(r.eventId) ?? 0) + 1);
    return m;
  };
  const teamCounts = countBy(teams);
  const subCounts = countBy(subs.filter((s) => s.status === "submitted"));
  const judgeCounts = countBy(judges);
  const certCounts = countBy(certs);

  res.json(events.map((ev) => {
    const owner = ownerById.get(ev.userId);
    return {
      ...serializeEvent(ev),
      ownerEmail: owner?.email ?? null,
      ownerName: owner?.name ?? null,
      teamCount: teamCounts.get(ev.id) ?? 0,
      submissionCount: subCounts.get(ev.id) ?? 0,
      judgeCount: judgeCounts.get(ev.id) ?? 0,
      certificateCount: certCounts.get(ev.id) ?? 0,
    };
  }));
});

router.get("/admin/voiceathon/events/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"]), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [ev] = await db.select().from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.id, id)).limit(1);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const [owner] = await db.select({ email: usersTable.email, name: usersTable.name })
    .from(usersTable).where(eq(usersTable.clerkId, ev.userId)).limit(1);

  const teams = await db.select().from(voiceathonTeamsTable)
    .where(eq(voiceathonTeamsTable.eventId, id))
    .orderBy(desc(voiceathonTeamsTable.createdAt));
  const teamIds = teams.map((t) => t.id);
  const members = teamIds.length
    ? await db.select().from(voiceathonTeamMembersTable)
      .where(inArray(voiceathonTeamMembersTable.teamId, teamIds))
      .orderBy(asc(voiceathonTeamMembersTable.sortOrder))
    : [];

  const submissions = await db.select({
    submission: voiceathonSubmissionsTable,
    agentName: agentsTable.name,
  })
    .from(voiceathonSubmissionsTable)
    .leftJoin(agentsTable, eq(voiceathonSubmissionsTable.agentId, agentsTable.id))
    .where(eq(voiceathonSubmissionsTable.eventId, id));
  const subByTeam = new Map(submissions.map((s) => [s.submission.teamId, s]));

  const judges = await db.select().from(voiceathonJudgesTable)
    .where(eq(voiceathonJudgesTable.eventId, id))
    .orderBy(desc(voiceathonJudgesTable.createdAt));
  const assignments = await db.select().from(voiceathonJudgeAssignmentsTable)
    .where(eq(voiceathonJudgeAssignmentsTable.eventId, id));
  const assignCount = new Map<number, number>();
  for (const a of assignments) assignCount.set(a.judgeId, (assignCount.get(a.judgeId) ?? 0) + 1);

  const scores = await db.select().from(voiceathonScoresTable)
    .where(eq(voiceathonScoresTable.eventId, id));
  const finalScoresByJudge = new Map<number, number>();
  for (const s of scores) {
    if (s.status === "final") {
      finalScoresByJudge.set(s.judgeId, (finalScoresByJudge.get(s.judgeId) ?? 0) + 1);
    }
  }

  const leaderboard = await buildLeaderboard(id);

  res.json({
    event: serializeEvent(ev, {
      ownerEmail: owner?.email ?? null,
      ownerName: owner?.name ?? null,
    }),
    teams: teams.map((t) => {
      const sub = subByTeam.get(t.id);
      return {
        id: t.id,
        name: t.name,
        referenceCode: t.referenceCode,
        institution: t.institution,
        city: t.city,
        leaderName: t.leaderName,
        leaderEmail: t.leaderEmail,
        status: t.status,
        placement: t.placement,
        claimed: !!t.claimedByUserId,
        members: members
          .filter((m) => m.teamId === t.id)
          .map((m) => ({ name: m.name, email: m.email, role: m.role })),
        submission: sub
          ? {
              status: sub.submission.status,
              agentName: sub.agentName,
              projectTitle: sub.submission.projectTitle,
              submittedAt: sub.submission.submittedAt?.toISOString() ?? null,
            }
          : null,
        createdAt: t.createdAt.toISOString(),
      };
    }),
    judges: judges.map((j) => ({
      id: j.id,
      name: j.name,
      email: j.email,
      status: j.status,
      assignmentCount: assignCount.get(j.id) ?? 0,
      finalizedScores: finalScoresByJudge.get(j.id) ?? 0,
      lastAccessAt: j.lastAccessAt?.toISOString() ?? null,
    })),
    leaderboard,
  });
});

export default router;
