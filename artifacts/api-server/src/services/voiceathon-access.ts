/**
 * Voice-a-thon lifecycle helpers — ownership, stage windows, scoring, tokens.
 */

import {
  db,
  voiceathonEventsTable,
  voiceathonTeamsTable,
  voiceathonTeamMembersTable,
  voiceathonSubmissionsTable,
  voiceathonJudgesTable,
  voiceathonScoresTable,
  type VoiceathonEvent,
  type VoiceathonTeam,
} from "@workspace/db";
import { and, eq, count } from "drizzle-orm";

export {
  normalizeEmail,
  slugify,
  mintReferenceCode,
  mintJudgeToken,
  hashJudgeToken,
  mintVerificationCode,
  mintCertificateCode,
  isRegistrationOpen,
  isSubmissionOpen,
  isJudgingOpen,
  ALLOWED_STATUS_TRANSITIONS,
  canTransitionStatus,
  computeWeightedTotal,
  publicEventPayload,
  serializeEvent,
} from "./voiceathon-rules.js";

import { slugify, hashJudgeToken } from "./voiceathon-rules.js";

export async function uniqueEventSlug(base: string, excludeId?: number): Promise<string> {
  let slug = slugify(base);
  for (let i = 0; i < 8; i++) {
    const [ex] = await db
      .select({ id: voiceathonEventsTable.id })
      .from(voiceathonEventsTable)
      .where(eq(voiceathonEventsTable.slug, slug))
      .limit(1);
    if (!ex || (excludeId != null && ex.id === excludeId)) return slug;
    slug = `${slugify(base)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${slugify(base)}-${Date.now().toString(36)}`;
}

export async function getOwnedEvent(
  eventId: number,
  userId: string,
): Promise<VoiceathonEvent | null> {
  const [ev] = await db
    .select()
    .from(voiceathonEventsTable)
    .where(and(eq(voiceathonEventsTable.id, eventId), eq(voiceathonEventsTable.userId, userId)))
    .limit(1);
  return ev ?? null;
}

export async function getEventBySlug(slug: string): Promise<VoiceathonEvent | null> {
  const [ev] = await db
    .select()
    .from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.slug, slug))
    .limit(1);
  return ev ?? null;
}

export async function countTeams(eventId: number): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(voiceathonTeamsTable)
    .where(eq(voiceathonTeamsTable.eventId, eventId));
  return Number(row?.c ?? 0);
}

export async function loadTeamWithMembers(teamId: number) {
  const [team] = await db
    .select()
    .from(voiceathonTeamsTable)
    .where(eq(voiceathonTeamsTable.id, teamId))
    .limit(1);
  if (!team) return null;
  const members = await db
    .select()
    .from(voiceathonTeamMembersTable)
    .where(eq(voiceathonTeamMembersTable.teamId, teamId));
  return { team, members };
}

export async function findTeamByLeaderClaim(
  eventId: number,
  userId: string,
  emailNormalized: string,
): Promise<VoiceathonTeam | null> {
  const [byClaim] = await db
    .select()
    .from(voiceathonTeamsTable)
    .where(and(
      eq(voiceathonTeamsTable.eventId, eventId),
      eq(voiceathonTeamsTable.claimedByUserId, userId),
    ))
    .limit(1);
  if (byClaim) return byClaim;

  const [byEmail] = await db
    .select()
    .from(voiceathonTeamsTable)
    .where(and(
      eq(voiceathonTeamsTable.eventId, eventId),
      eq(voiceathonTeamsTable.leaderEmailNormalized, emailNormalized),
    ))
    .limit(1);
  return byEmail ?? null;
}

export async function getJudgeByToken(token: string) {
  const hash = hashJudgeToken(token);
  const [judge] = await db
    .select()
    .from(voiceathonJudgesTable)
    .where(eq(voiceathonJudgesTable.tokenHash, hash))
    .limit(1);
  if (!judge || judge.status === "revoked") return null;
  return judge;
}

export type LeaderboardRow = {
  teamId: number;
  teamName: string;
  placement: string;
  averageScore: number | null;
  scoreCount: number;
  submittedAt: string | null;
  rank: number;
};

export async function buildLeaderboard(eventId: number): Promise<LeaderboardRow[]> {
  const teams = await db
    .select()
    .from(voiceathonTeamsTable)
    .where(eq(voiceathonTeamsTable.eventId, eventId));
  const submissions = await db
    .select()
    .from(voiceathonSubmissionsTable)
    .where(and(
      eq(voiceathonSubmissionsTable.eventId, eventId),
      eq(voiceathonSubmissionsTable.status, "submitted"),
    ));
  const scores = await db
    .select()
    .from(voiceathonScoresTable)
    .where(and(
      eq(voiceathonScoresTable.eventId, eventId),
      eq(voiceathonScoresTable.status, "final"),
    ));

  const subByTeam = new Map(submissions.map((s) => [s.teamId, s]));
  const scoresByTeam = new Map<number, number[]>();
  for (const s of scores) {
    const arr = scoresByTeam.get(s.teamId) ?? [];
    arr.push(s.totalScore);
    scoresByTeam.set(s.teamId, arr);
  }

  const rows: Omit<LeaderboardRow, "rank">[] = teams
    .filter((t) => t.status !== "disqualified" && t.status !== "withdrawn")
    .map((t) => {
      const sc = scoresByTeam.get(t.id) ?? [];
      const avg = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
      const sub = subByTeam.get(t.id);
      return {
        teamId: t.id,
        teamName: t.name,
        placement: t.placement,
        averageScore: avg,
        scoreCount: sc.length,
        submittedAt: sub?.submittedAt?.toISOString() ?? null,
      };
    });

  rows.sort((a, b) => {
    if (a.averageScore == null && b.averageScore == null) {
      return (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "");
    }
    if (a.averageScore == null) return 1;
    if (b.averageScore == null) return -1;
    if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
    return (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "");
  });

  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
