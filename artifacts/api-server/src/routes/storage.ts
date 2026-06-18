/**
 * Call recording serving route — streams WAV bytes stored in PostgreSQL.
 *
 * GET /storage/recordings/:callId — serve a call's recording (audio/wav).
 *   - Requires an authenticated session (Bearer header or ?token= query).
 *   - Enforces ownership: only the user who owns the call may fetch it.
 *   - Supports HTTP Range requests so the audio player can seek/scrub.
 */
import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, callsTable, callRecordingsTable, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

router.get("/storage/recordings/:callId", requireAuth, async (req, res): Promise<void> => {
  const rawId = (req.params as { callId?: string | string[] }).callId;
  const idStr = Array.isArray(rawId) ? rawId[0] ?? "" : rawId ?? "";
  const callId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(callId)) {
    res.status(400).json({ error: "Invalid call id" });
    return;
  }

  const clerkId = (req as unknown as { clerkUserId?: string }).clerkUserId ?? null;

  // Ownership: call.userId must match the requester, or (for legacy rows where
  // userId is null) the call's agent must belong to the requester.
  const [call] = await db
    .select({ id: callsTable.id, userId: callsTable.userId, agentId: callsTable.agentId })
    .from(callsTable)
    .where(eq(callsTable.id, callId));
  if (!call) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }
  if (call.userId && call.userId !== clerkId) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }
  if (!call.userId) {
    const [agent] = await db
      .select({ userId: agentsTable.userId })
      .from(agentsTable)
      .where(eq(agentsTable.id, call.agentId));
    if (agent?.userId && agent.userId !== clerkId) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }
  }

  const [rec] = await db
    .select({
      audio: callRecordingsTable.audio,
      contentType: callRecordingsTable.contentType,
      byteSize: callRecordingsTable.byteSize,
    })
    .from(callRecordingsTable)
    .where(eq(callRecordingsTable.callId, callId))
    .orderBy(desc(callRecordingsTable.id))
    .limit(1);

  if (!rec) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  const audio = rec.audio;
  const total = audio.length;
  const contentType = rec.contentType || "audio/wav";

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=86400");

  const rangeHeader = req.headers["range"];
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (match) {
      const startStr = match[1] ?? "";
      const endStr = match[2] ?? "";
      let start = startStr ? Number.parseInt(startStr, 10) : 0;
      let end = endStr ? Number.parseInt(endStr, 10) : total - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`);
        res.end();
        return;
      }
      const chunk = audio.subarray(start, end + 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(chunk.length));
      res.end(chunk);
      return;
    }
  }

  res.setHeader("Content-Length", String(total));
  res.end(audio);
});

export default router;
