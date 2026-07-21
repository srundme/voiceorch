/**
 * Public Voice-a-thon routes — event landing, team registration, judge portal,
 * public leaderboard, certificate verification.
 * Mounted before provisionUser (no Clerk session required).
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  voiceathonEventsTable,
  voiceathonTeamsTable,
  voiceathonTeamMembersTable,
  voiceathonSubmissionsTable,
  voiceathonJudgesTable,
  voiceathonJudgeAssignmentsTable,
  voiceathonScoresTable,
  voiceathonCertificatesTable,
  voiceathonPhoneOtpsTable,
  webcallLinksTable,
  agentsTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail, sendBrevoSms } from "../services/brevo.js";
import {
  voiceathonMetaRateLimit,
  voiceathonSubmitRateLimit,
  voiceathonJudgeRateLimit,
  voiceathonOtpSendRateLimit,
  voiceathonOtpVerifyRateLimit,
} from "../lib/rate-limit.js";
import {
  getEventBySlug,
  publicEventPayload,
  isRegistrationOpen,
  isJudgingOpen,
  normalizeEmail,
  normalizeIndianPhone,
  hashVoiceathonSecret,
  matchesVoiceathonSecret,
  mintOtpCode,
  mintOtpVerificationToken,
  mintReferenceCode,
  countTeams,
  getJudgeByToken,
  computeWeightedTotal,
  buildLeaderboard,
} from "../services/voiceathon-access.js";

const router: IRouter = Router();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character]!);
}

const Slug = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, "slug must be alphanumeric/dash");

const MemberBody = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().min(10).max(40),
  linkedinUrl: z.string().url().max(500).refine(
    (value) => /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(value),
    "LinkedIn profile URL is required",
  ),
});

const RegisterBody = z.object({
  teamName: z.string().trim().min(1).max(200),
  institution: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(120).optional().or(z.literal("")),
  leaderName: z.string().trim().min(1).max(200),
  leaderEmail: z.string().email().max(320),
  leaderPhone: z.string().min(10).max(40),
  leaderLinkedinUrl: z.string().url().max(500).refine(
    (value) => /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(value),
    "LinkedIn profile URL is required",
  ),
  phoneVerificationToken: z.string().min(20).max(200),
  members: z.array(MemberBody).max(20).default([]),
});

// ── Public event meta ────────────────────────────────────────────────────────

router.get("/voiceathon/public/:slug", voiceathonMetaRateLimit, async (req, res): Promise<void> => {
  const parsed = Slug.safeParse(req.params["slug"]);
  if (!parsed.success) { res.status(400).json({ error: "Invalid slug" }); return; }
  try {
    const ev = await getEventBySlug(parsed.data);
    if (!ev || ev.status === "draft" || ev.status === "archived") {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    const teamCount = await countTeams(ev.id);
    const payload = publicEventPayload(ev);
    let leaderboard: Awaited<ReturnType<typeof buildLeaderboard>> | null = null;
    if (ev.leaderboardPublished) {
      leaderboard = await buildLeaderboard(ev.id);
    }
    res.json({
      ...payload,
      teamCount,
      spotsRemaining: ev.maxTeams != null ? Math.max(0, ev.maxTeams - teamCount) : null,
      leaderboard,
    });
  } catch (err) {
    logger.error({ err, slug: parsed.data }, "voiceathon public meta failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── Team registration ────────────────────────────────────────────────────────

router.post("/voiceathon/public/:slug/otp/send", voiceathonOtpSendRateLimit, async (req, res): Promise<void> => {
  const slugParsed = Slug.safeParse(req.params["slug"]);
  const body = z.object({ phone: z.string().min(10).max(40) }).safeParse(req.body);
  if (!slugParsed.success || !body.success) {
    res.status(400).json({ error: "Enter a valid mobile number" });
    return;
  }
  const phone = normalizeIndianPhone(body.data.phone);
  if (!phone) {
    res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number" });
    return;
  }
  const ev = await getEventBySlug(slugParsed.data);
  if (!ev || !isRegistrationOpen(ev)) {
    res.status(403).json({ error: "Registration is not open" });
    return;
  }

  // Invalidate earlier unused challenges for this event+phone so only the
  // newest OTP remains valid (resend / concurrent send hardening).
  await db.update(voiceathonPhoneOtpsTable)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(voiceathonPhoneOtpsTable.eventId, ev.id),
      eq(voiceathonPhoneOtpsTable.phoneNormalized, phone),
      isNull(voiceathonPhoneOtpsTable.consumedAt),
    ));

  const code = mintOtpCode();
  const challengeToken = mintOtpVerificationToken();
  const [otp] = await db.insert(voiceathonPhoneOtpsTable).values({
    eventId: ev.id,
    phoneNormalized: phone,
    codeHash: hashVoiceathonSecret(code),
    verificationTokenHash: hashVoiceathonSecret(challengeToken),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  }).returning({ id: voiceathonPhoneOtpsTable.id });

  try {
    await sendBrevoSms(phone, `${code} is your SnapServe ${ev.title} registration OTP. Valid for 10 minutes. Do not share it.`);
    res.json({ ok: true, challengeToken, expiresInSeconds: 600 });
  } catch (err) {
    await db.delete(voiceathonPhoneOtpsTable).where(eq(voiceathonPhoneOtpsTable.id, otp!.id));
    logger.error({ err, eventId: ev.id }, "voiceathon OTP SMS failed");
    res.status(503).json({ error: "Could not send OTP. Please try again." });
  }
});

router.post("/voiceathon/public/:slug/otp/verify", voiceathonOtpVerifyRateLimit, async (req, res): Promise<void> => {
  const slugParsed = Slug.safeParse(req.params["slug"]);
  const body = z.object({
    phone: z.string().min(10).max(40),
    challengeToken: z.string().min(20).max(200),
    code: z.string().regex(/^\d{6}$/),
  }).safeParse(req.body);
  if (!slugParsed.success || !body.success) {
    res.status(400).json({ error: "Invalid OTP request" });
    return;
  }
  const phone = normalizeIndianPhone(body.data.phone);
  if (!phone) {
    res.status(400).json({ error: "Invalid mobile number" });
    return;
  }
  const ev = await getEventBySlug(slugParsed.data);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  const [otp] = await db.select().from(voiceathonPhoneOtpsTable).where(and(
    eq(voiceathonPhoneOtpsTable.eventId, ev.id),
    eq(voiceathonPhoneOtpsTable.phoneNormalized, phone),
    eq(voiceathonPhoneOtpsTable.verificationTokenHash, hashVoiceathonSecret(body.data.challengeToken)),
    isNull(voiceathonPhoneOtpsTable.consumedAt),
  )).orderBy(desc(voiceathonPhoneOtpsTable.createdAt)).limit(1);

  if (!otp || otp.expiresAt < new Date() || otp.attempts >= 5) {
    res.status(400).json({ error: "OTP expired. Request a new code." });
    return;
  }
  if (!matchesVoiceathonSecret(body.data.code, otp.codeHash)) {
    await db.update(voiceathonPhoneOtpsTable)
      .set({ attempts: otp.attempts + 1 })
      .where(eq(voiceathonPhoneOtpsTable.id, otp.id));
    res.status(400).json({ error: "Incorrect OTP" });
    return;
  }

  const verificationToken = mintOtpVerificationToken();
  await db.update(voiceathonPhoneOtpsTable).set({
    verifiedAt: new Date(),
    verificationTokenHash: hashVoiceathonSecret(verificationToken),
  }).where(eq(voiceathonPhoneOtpsTable.id, otp.id));
  res.json({ ok: true, verificationToken });
});

router.post("/voiceathon/public/:slug/register", voiceathonSubmitRateLimit, async (req, res): Promise<void> => {
  const slugParsed = Slug.safeParse(req.params["slug"]);
  if (!slugParsed.success) { res.status(400).json({ error: "Invalid slug" }); return; }
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid registration", details: parsed.error.flatten() });
    return;
  }

  try {
    const ev = await getEventBySlug(slugParsed.data);
    if (!ev || ev.status === "draft" || ev.status === "archived") {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    if (!isRegistrationOpen(ev)) {
      res.status(403).json({ error: "Registration is closed for this event" });
      return;
    }

    const b = parsed.data;
    const leaderEmailNorm = normalizeEmail(b.leaderEmail);
    const leaderPhoneNorm = normalizeIndianPhone(b.leaderPhone);
    if (!leaderPhoneNorm) {
      res.status(400).json({ error: "Enter a valid leader mobile number" });
      return;
    }
    const normalizedMembers = b.members.map((member) => ({
      ...member,
      phoneNormalized: normalizeIndianPhone(member.phone),
    }));
    if (normalizedMembers.some((member) => !member.phoneNormalized)) {
      res.status(400).json({ error: "Every team member must have a valid Indian mobile number" });
      return;
    }

    const [verifiedOtp] = await db.select().from(voiceathonPhoneOtpsTable).where(and(
      eq(voiceathonPhoneOtpsTable.eventId, ev.id),
      eq(voiceathonPhoneOtpsTable.phoneNormalized, leaderPhoneNorm),
      eq(voiceathonPhoneOtpsTable.verificationTokenHash, hashVoiceathonSecret(b.phoneVerificationToken)),
      isNull(voiceathonPhoneOtpsTable.consumedAt),
    )).orderBy(desc(voiceathonPhoneOtpsTable.verifiedAt)).limit(1);
    if (!verifiedOtp?.verifiedAt || verifiedOtp.expiresAt < new Date()) {
      res.status(400).json({ error: "Verify the leader mobile number before registering" });
      return;
    }

    // Build full member list: leader + additional members.
    const extraMembers = normalizedMembers.filter((m) => m.name.trim());
    const allPeople = [
      {
        name: b.leaderName.trim(),
        email: b.leaderEmail.trim(),
        emailNormalized: leaderEmailNorm,
        phone: leaderPhoneNorm,
        linkedinUrl: b.leaderLinkedinUrl.trim(),
        role: "leader" as const,
      },
      ...extraMembers.map((m, i) => ({
        name: m.name.trim(),
        email: m.email.trim(),
        emailNormalized: normalizeEmail(m.email),
        phone: m.phoneNormalized!,
        linkedinUrl: m.linkedinUrl.trim(),
        role: "member" as const,
        sortHint: i + 1,
      })),
    ];

    const teamSize = allPeople.length;
    if (teamSize < ev.minTeamSize || teamSize > ev.maxTeamSize) {
      res.status(400).json({
        error: `Team size must be between ${ev.minTeamSize} and ${ev.maxTeamSize} (including the leader)`,
      });
      return;
    }

    if (ev.maxTeams != null) {
      const current = await countTeams(ev.id);
      if (current >= ev.maxTeams) {
        res.status(403).json({ error: "This event has reached its team capacity" });
        return;
      }
    }

    const teamNameNormalized = b.teamName.trim().replace(/\s+/g, " ").toLowerCase();
    const [duplicateTeam] = await db.select({ id: voiceathonTeamsTable.id })
      .from(voiceathonTeamsTable)
      .where(and(
        eq(voiceathonTeamsTable.eventId, ev.id),
        eq(voiceathonTeamsTable.nameNormalized, teamNameNormalized),
      ))
      .limit(1);
    if (duplicateTeam) {
      res.status(409).json({ error: "This team name is already taken. Choose another name." });
      return;
    }

    const [duplicateLeader] = await db.select({ id: voiceathonTeamsTable.id })
      .from(voiceathonTeamsTable)
      .where(and(
        eq(voiceathonTeamsTable.eventId, ev.id),
        eq(voiceathonTeamsTable.leaderEmailNormalized, leaderEmailNorm),
      ))
      .limit(1);
    if (duplicateLeader) {
      res.status(409).json({ error: "A team with this leader email is already registered" });
      return;
    }

    const referenceCode = mintReferenceCode();
    const team = await db.transaction(async (tx) => {
      const [consumedOtp] = await tx.update(voiceathonPhoneOtpsTable)
        .set({ consumedAt: new Date() })
        .where(and(
          eq(voiceathonPhoneOtpsTable.id, verifiedOtp.id),
          isNull(voiceathonPhoneOtpsTable.consumedAt),
        ))
        .returning({ id: voiceathonPhoneOtpsTable.id });
      if (!consumedOtp) throw new Error("OTP was already used");

      const [created] = await tx.insert(voiceathonTeamsTable).values({
        eventId: ev.id,
        name: b.teamName.trim(),
        nameNormalized: teamNameNormalized,
        referenceCode,
        institution: b.institution?.trim() || null,
        city: b.city?.trim() || null,
        leaderName: b.leaderName.trim(),
        leaderEmail: b.leaderEmail.trim(),
        leaderEmailNormalized: leaderEmailNorm,
        leaderPhone: leaderPhoneNorm,
        leaderLinkedinUrl: b.leaderLinkedinUrl.trim(),
        phoneVerifiedAt: verifiedOtp.verifiedAt,
        status: "pending",
      }).returning();
      if (!created) throw new Error("Team insert failed");

      await tx.insert(voiceathonTeamMembersTable).values(
        allPeople.map((person, index) => ({
          teamId: created.id,
          name: person.name,
          email: person.email,
          emailNormalized: person.emailNormalized,
          phone: person.phone,
          linkedinUrl: person.linkedinUrl,
          role: person.role,
          sortOrder: index,
        })),
      );
      return created;
    });

    try {
      await sendBrevoEmail(
        team.leaderEmail,
        `Registration received for ${ev.title} — ${referenceCode}`,
        `<p>Hi ${escapeHtml(team.leaderName)},</p>
         <p>We received the registration for team <strong>${escapeHtml(team.name)}</strong> at <strong>${escapeHtml(ev.title)}</strong>.</p>
         <p>Team reference: <strong>${referenceCode}</strong></p>
         <p>SnapServe will review your team details. If approved, your official event ticket will be sent to this email.</p>`,
        undefined,
        { emailType: "voiceathon_registration", toName: team.leaderName },
      );
    } catch (mailErr) {
      logger.warn({ err: mailErr, teamId: team.id }, "Registration confirmation email failed");
    }

    res.status(201).json({
      ok: true,
      referenceCode,
      teamName: team.name,
      eventTitle: ev.title,
      status: "pending",
      message: "Registration received and pending SnapServe approval.",
    });
  } catch (err: any) {
    if (String(err?.message ?? "").includes("OTP was already used")) {
      res.status(409).json({ error: "This OTP verification was already used. Verify the mobile number again." });
      return;
    }
    if (err?.code === "23505") {
      const constraint = String(err?.constraint ?? "");
      res.status(409).json({
        error: constraint.includes("event_name")
          ? "This team name is already taken. Choose another name."
          : "A team with this leader email is already registered",
      });
      return;
    }
    logger.error({ err, slug: slugParsed.data }, "voiceathon register failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── Judge portal ─────────────────────────────────────────────────────────────

router.get("/voiceathon/judge/:token", voiceathonJudgeRateLimit, async (req, res): Promise<void> => {
  const token = String(req.params["token"] ?? "");
  const judge = await getJudgeByToken(token);
  if (!judge) { res.status(404).json({ error: "Invalid or revoked judge link" }); return; }

  const [ev] = await db.select().from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.id, judge.eventId)).limit(1);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }

  await db.update(voiceathonJudgesTable)
    .set({ lastAccessAt: new Date(), status: judge.status === "invited" ? "active" : judge.status })
    .where(eq(voiceathonJudgesTable.id, judge.id));

  const assignments = await db.select().from(voiceathonJudgeAssignmentsTable)
    .where(eq(voiceathonJudgeAssignmentsTable.judgeId, judge.id));
  const subIds = assignments.map((a) => a.submissionId);

  const submissions = subIds.length
    ? await db.select({
        submission: voiceathonSubmissionsTable,
        teamName: voiceathonTeamsTable.name,
        teamReference: voiceathonTeamsTable.referenceCode,
        webcallToken: webcallLinksTable.token,
        agentName: agentsTable.name,
      })
      .from(voiceathonSubmissionsTable)
      .innerJoin(voiceathonTeamsTable, eq(voiceathonSubmissionsTable.teamId, voiceathonTeamsTable.id))
      .leftJoin(webcallLinksTable, eq(voiceathonSubmissionsTable.webcallLinkId, webcallLinksTable.id))
      .leftJoin(agentsTable, eq(voiceathonSubmissionsTable.agentId, agentsTable.id))
      .where(and(
        inArray(voiceathonSubmissionsTable.id, subIds),
        eq(voiceathonSubmissionsTable.status, "submitted"),
      ))
    : [];

  const scores = await db.select().from(voiceathonScoresTable)
    .where(eq(voiceathonScoresTable.judgeId, judge.id));
  const scoreBySub = new Map(scores.map((s) => [s.submissionId, s]));

  res.json({
    judge: { name: judge.name, email: judge.email },
    event: {
      title: ev.title,
      slug: ev.slug,
      rubric: ev.rubric ?? [],
      judgingOpen: isJudgingOpen(ev),
    },
    assignments: submissions.map((r) => {
      const sc = scoreBySub.get(r.submission.id);
      return {
        submissionId: r.submission.id,
        teamName: r.teamName,
        teamReference: r.teamReference,
        projectTitle: r.submission.projectTitle,
        projectSummary: r.submission.projectSummary,
        agentName: r.agentName,
        demoUrl: r.webcallToken ? `/join/${r.webcallToken}` : null,
        score: sc
          ? {
              id: sc.id,
              criteriaScores: sc.criteriaScores,
              totalScore: sc.totalScore,
              privateFeedback: sc.privateFeedback,
              status: sc.status,
            }
          : null,
      };
    }),
  });
});

router.post("/voiceathon/judge/:token/scores", voiceathonJudgeRateLimit, async (req, res): Promise<void> => {
  const token = String(req.params["token"] ?? "");
  const judge = await getJudgeByToken(token);
  if (!judge) { res.status(404).json({ error: "Invalid or revoked judge link" }); return; }

  const [ev] = await db.select().from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.id, judge.eventId)).limit(1);
  if (!ev) { res.status(404).json({ error: "Event not found" }); return; }
  if (!isJudgingOpen(ev)) {
    res.status(403).json({ error: "Judging is closed for this event" });
    return;
  }

  const parsed = z.object({
    submissionId: z.number().int().positive(),
    criteriaScores: z.array(z.object({
      criterionId: z.string().min(1).max(64),
      score: z.number().min(0).max(100),
      note: z.string().max(2000).optional(),
    })).min(1).max(30),
    privateFeedback: z.string().max(5000).nullable().optional(),
    finalize: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }

  const [assignment] = await db.select().from(voiceathonJudgeAssignmentsTable)
    .where(and(
      eq(voiceathonJudgeAssignmentsTable.judgeId, judge.id),
      eq(voiceathonJudgeAssignmentsTable.submissionId, parsed.data.submissionId),
    ))
    .limit(1);
  if (!assignment) {
    res.status(403).json({ error: "This submission is not assigned to you" });
    return;
  }

  const [sub] = await db.select().from(voiceathonSubmissionsTable)
    .where(and(
      eq(voiceathonSubmissionsTable.id, parsed.data.submissionId),
      eq(voiceathonSubmissionsTable.status, "submitted"),
    ))
    .limit(1);
  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }

  const [existing] = await db.select().from(voiceathonScoresTable)
    .where(and(
      eq(voiceathonScoresTable.judgeId, judge.id),
      eq(voiceathonScoresTable.submissionId, sub.id),
    ))
    .limit(1);
  if (existing?.status === "final") {
    res.status(403).json({ error: "Score already finalized and cannot be changed" });
    return;
  }

  const totalScore = computeWeightedTotal(ev.rubric ?? [], parsed.data.criteriaScores);
  const finalize = parsed.data.finalize === true;

  let row;
  if (existing) {
    const [upd] = await db.update(voiceathonScoresTable).set({
      criteriaScores: parsed.data.criteriaScores,
      totalScore,
      privateFeedback: parsed.data.privateFeedback ?? null,
      status: finalize ? "final" : "draft",
      finalizedAt: finalize ? new Date() : null,
    }).where(eq(voiceathonScoresTable.id, existing.id)).returning();
    row = upd;
  } else {
    const [ins] = await db.insert(voiceathonScoresTable).values({
      eventId: ev.id,
      judgeId: judge.id,
      submissionId: sub.id,
      teamId: sub.teamId,
      criteriaScores: parsed.data.criteriaScores,
      totalScore,
      privateFeedback: parsed.data.privateFeedback ?? null,
      status: finalize ? "final" : "draft",
      finalizedAt: finalize ? new Date() : null,
    }).returning();
    row = ins;
  }

  res.json({
    ok: true,
    score: {
      id: row!.id,
      totalScore: row!.totalScore,
      status: row!.status,
      criteriaScores: row!.criteriaScores,
    },
  });
});

// ── Certificate verify ───────────────────────────────────────────────────────

router.get("/voiceathon/certificates/:code/verify", voiceathonMetaRateLimit, async (req, res): Promise<void> => {
  const code = String(req.params["code"] ?? "").trim().toUpperCase();
  if (!code || code.length > 64) {
    res.status(400).json({ error: "Invalid code" });
    return;
  }
  const [cert] = await db.select().from(voiceathonCertificatesTable)
    .where(eq(voiceathonCertificatesTable.verificationCode, code))
    .limit(1);
  if (!cert) { res.status(404).json({ error: "Certificate not found" }); return; }

  const [ev] = await db.select({
    title: voiceathonEventsTable.title,
    slug: voiceathonEventsTable.slug,
  }).from(voiceathonEventsTable)
    .where(eq(voiceathonEventsTable.id, cert.eventId)).limit(1);

  res.json({
    valid: true,
    recipientName: cert.recipientName,
    teamName: cert.teamName,
    type: cert.type,
    eventTitle: ev?.title ?? null,
    eventSlug: ev?.slug ?? null,
    issuedAt: cert.issuedAt.toISOString(),
    verificationCode: cert.verificationCode,
  });
});

export default router;
