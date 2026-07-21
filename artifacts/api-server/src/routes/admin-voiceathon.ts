/**
 * Admin — Voice-a-thon management.
 *
 * Full event lifecycle management from the admin panel, gated by requireAdmin
 * (x-admin-token). Instead of duplicating the organizer routes, the existing
 * voiceathon-events router is mounted under /admin with an impersonation shim:
 * for event-scoped paths the shim resolves the event's owner and sets
 * req.clerkUserId to it so the router's ownership checks pass; event creation
 * runs as the "admin" sentinel owner.
 *
 * The all-events list (across every organizer, with owner info) is defined
 * here directly since the organizer list is owner-scoped.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  voiceathonEventsTable,
  voiceathonTeamsTable,
  voiceathonSubmissionsTable,
  voiceathonJudgesTable,
  voiceathonCertificatesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { serializeEvent } from "../services/voiceathon-rules.js";
import voiceathonEventsRouter from "./voiceathon-events.js";

/** Owner recorded on events created from the admin panel. */
const ADMIN_OWNER_ID = "admin";

const router: IRouter = Router();
router.use("/admin/voiceathon", requireAdmin);

// ── All events across organizers (must be registered before the passthrough) ─

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
      ownerEmail: owner?.email ?? (ev.userId === ADMIN_OWNER_ID ? "admin panel" : null),
      ownerName: owner?.name ?? null,
      teamCount: teamCounts.get(ev.id) ?? 0,
      submissionCount: subCounts.get(ev.id) ?? 0,
      judgeCount: judgeCounts.get(ev.id) ?? 0,
      certificateCount: certCounts.get(ev.id) ?? 0,
    };
  }));
});

// ── Passthrough to the organizer router with owner impersonation ─────────────

async function impersonateEventOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.path.startsWith("/voiceathon/")) { next(); return; }
  // Re-verify the admin token here: this middleware is mounted at /admin (not
  // /admin/voiceathon), so it must never impersonate without admin auth.
  let authorized = false;
  requireAdmin(req, res, () => { authorized = true; });
  if (!authorized) return;
  try {
    const evMatch = req.path.match(/^\/voiceathon\/events\/(\d+)/);
    const certMatch = req.path.match(/^\/voiceathon\/certificates\/(\d+)/);

    if (evMatch) {
      const [ev] = await db.select({ userId: voiceathonEventsTable.userId })
        .from(voiceathonEventsTable)
        .where(eq(voiceathonEventsTable.id, parseInt(evMatch[1]!, 10)))
        .limit(1);
      if (!ev) { res.status(404).json({ error: "Event not found" }); return; }
      (req as any).clerkUserId = ev.userId;
    } else if (certMatch) {
      const [cert] = await db.select({ eventId: voiceathonCertificatesTable.eventId })
        .from(voiceathonCertificatesTable)
        .where(eq(voiceathonCertificatesTable.id, parseInt(certMatch[1]!, 10)))
        .limit(1);
      if (!cert) { res.status(404).json({ error: "Certificate not found" }); return; }
      const [ev] = await db.select({ userId: voiceathonEventsTable.userId })
        .from(voiceathonEventsTable)
        .where(eq(voiceathonEventsTable.id, cert.eventId))
        .limit(1);
      if (!ev) { res.status(404).json({ error: "Event not found" }); return; }
      (req as any).clerkUserId = ev.userId;
    } else {
      // e.g. POST /voiceathon/events (create)
      (req as any).clerkUserId = ADMIN_OWNER_ID;
    }
    next();
  } catch (err) {
    next(err);
  }
}

// Requests to /admin/voiceathon/* have already passed requireAdmin above.
// Mounting at /admin strips the prefix so the organizer router's /voiceathon/*
// paths line up: /api/admin/voiceathon/events/:id/teams etc.
router.use("/admin", impersonateEventOwner, voiceathonEventsRouter);

export default router;
