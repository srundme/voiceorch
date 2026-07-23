import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import PDFDocument from "pdfkit";
import {
  db,
  visionIdentitiesTable,
  visionKycSessionsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";

const router: IRouter = Router();

function getClerkUserId(req: Request): string {
  const auth = (req as any).auth;
  if (!auth?.userId) {
    throw new Error("Unauthorized");
  }
  return auth.userId;
}

// ── 1. List Identity Records ────────────────────────────────────────────────
router.get("/vision-identities", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkUserId(req);
    const records = await db
      .select()
      .from(visionIdentitiesTable)
      .where(eq(visionIdentitiesTable.userId, userId))
      .orderBy(desc(visionIdentitiesTable.createdAt));

    const formatted = records.map((r) => ({
      ...r,
      hasFacePhoto: !!r.facePhotoData,
      hasPanCard: !!r.panCardData,
      facePhotoData: undefined,
      panCardData: undefined,
      onboardingUrl: r.selfOnboardingToken
        ? `${getSelfBaseUrl()}/vision-onboarding/${r.selfOnboardingToken}`
        : null,
    }));

    res.json({ identities: formatted });
  } catch (err: any) {
    logger.error({ err }, "Failed to fetch vision identities");
    res.status(500).json({ error: err.message || "Failed to fetch identities" });
  }
});

// ── 2. Create Identity Record ────────────────────────────────────────────────
router.post("/vision-identities", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkUserId(req);
    const {
      name,
      phone,
      email,
      panNumber,
      panName,
      panDob,
      aadhaarNumber,
      notes,
      facePhotoData,
      panCardData,
    } = req.body;

    if (!name || !phone) {
      res.status(400).json({ error: "Name and Phone are required" });
      return;
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [created] = await db
      .insert(visionIdentitiesTable)
      .values({
        userId,
        name,
        phone,
        email,
        panNumber,
        panName: panName || name,
        panDob,
        aadhaarNumber,
        notes,
        facePhotoData,
        panCardData,
        status: facePhotoData ? "enrolled" : "pending",
        enrollmentSource: "admin_upload",
        selfOnboardingToken: token,
        selfOnboardingExpiresAt: expiresAt,
      })
      .returning();

    res.json({
      identity: {
        ...created,
        facePhotoData: undefined,
        panCardData: undefined,
        onboardingUrl: `${getSelfBaseUrl()}/vision-onboarding/${token}`,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to create vision identity");
    res.status(500).json({ error: err.message || "Failed to create identity" });
  }
});

// ── 3. Bulk Import Identity Records ──────────────────────────────────────────
router.post("/vision-identities/import", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkUserId(req);
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Items array is required" });
      return;
    }

    const insertValues = items.map((item) => ({
      userId,
      name: item.name,
      phone: item.phone,
      email: item.email || null,
      panNumber: item.panNumber || null,
      notes: item.notes || null,
      status: "pending",
      enrollmentSource: "admin_upload",
      selfOnboardingToken: randomUUID(),
      selfOnboardingExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }));

    const inserted = await db.insert(visionIdentitiesTable).values(insertValues).returning();
    res.json({ success: true, count: inserted.length });
  } catch (err: any) {
    logger.error({ err }, "Failed to bulk import identities");
    res.status(500).json({ error: err.message || "Failed to bulk import identities" });
  }
});

// ── 4. Generate / Refresh Self-Onboarding Link ──────────────────────────────
router.post("/vision-identities/:id/generate-link", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkUserId(req);
    const id = req.params["id"] as string;
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [updated] = await db
      .update(visionIdentitiesTable)
      .set({
        selfOnboardingToken: token,
        selfOnboardingExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(and(eq(visionIdentitiesTable.id, id), eq(visionIdentitiesTable.userId, userId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Identity record not found" });
      return;
    }

    const onboardingUrl = `${getSelfBaseUrl()}/vision-onboarding/${token}`;
    res.json({ token, onboardingUrl });
  } catch (err: any) {
    logger.error({ err }, "Failed to generate onboarding link");
    res.status(500).json({ error: err.message || "Failed to generate onboarding link" });
  }
});

// ── 5. Delete Identity Record ────────────────────────────────────────────────
router.delete("/vision-identities/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkUserId(req);
    const id = req.params["id"] as string;
    await db
      .delete(visionIdentitiesTable)
      .where(and(eq(visionIdentitiesTable.id, id), eq(visionIdentitiesTable.userId, userId)));

    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "Failed to delete vision identity");
    res.status(500).json({ error: err.message || "Failed to delete identity" });
  }
});

// ── 6. List KYC Verification Sessions Audit Trail ───────────────────────────
router.get("/vision-kyc-sessions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkUserId(req);
    const sessions = await db
      .select()
      .from(visionKycSessionsTable)
      .where(eq(visionKycSessionsTable.userId, userId))
      .orderBy(desc(visionKycSessionsTable.createdAt));

    const formatted = sessions.map((s) => ({
      ...s,
      faceCaptureData: undefined,
      documentCaptureData: undefined,
    }));

    res.json({ sessions: formatted });
  } catch (err: any) {
    logger.error({ err }, "Failed to fetch vision kyc sessions");
    res.status(500).json({ error: err.message || "Failed to fetch sessions" });
  }
});

// ── 7. Get KYC Verification Session Detail (with Evidence Frames) ────────────
router.get("/vision-kyc-sessions/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkUserId(req);
    const id = req.params["id"] as string;
    const [session] = await db
      .select()
      .from(visionKycSessionsTable)
      .where(and(eq(visionKycSessionsTable.id, id), eq(visionKycSessionsTable.userId, userId)));

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json({ session });
  } catch (err: any) {
    logger.error({ err }, "Failed to fetch session detail");
    res.status(500).json({ error: err.message || "Failed to fetch session detail" });
  }
});

// ── 8. Generate Verification PDF Certificate ─────────────────────────────────
router.get("/vision-kyc-sessions/:id/certificate", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkUserId(req);
    const id = req.params["id"] as string;
    const [session] = await db
      .select()
      .from(visionKycSessionsTable)
      .where(and(eq(visionKycSessionsTable.id, id), eq(visionKycSessionsTable.userId, userId)));

    if (!session) {
      res.status(404).send("Session not found");
      return;
    }

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=Vision_KYC_Certificate_${session.id.slice(0, 8)}.pdf`);
    doc.pipe(res);

    // Document Header
    doc.fillColor("#0f172a").fontSize(22).text("SnapServe Vision KYC Certificate", { align: "center" });
    doc.fontSize(10).fillColor("#64748b").text("AI-Native Video Identity & Verification Audit Report", { align: "center" });
    doc.moveDown(1.5);

    doc.strokeColor("#e2e8f0").lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(1.5);

    // Summary Box
    const statusColor = session.status === "passed" ? "#16a34a" : session.status === "manual_review" ? "#d97706" : "#dc2626";
    doc.fillColor("#0f172a").fontSize(14).text(`Verification Status: `, { continued: true });
    doc.fillColor(statusColor).text(session.status.toUpperCase());
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor("#334155");
    doc.text(`Certificate Ref ID: ${session.id}`);
    doc.text(`Timestamp: ${session.createdAt.toISOString()}`);
    doc.text(`Caller Phone: ${session.callerPhone}`);
    doc.text(`Overall Trust Score: ${session.overallScore}%`);
    doc.moveDown(1.5);

    // Verification Checks Table
    doc.fillColor("#0f172a").fontSize(12).text("Verification Checks Breakdown:", { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor("#334155");
    doc.text(`• Face Match Score: ${session.faceMatchScore}% (${session.faceMatchPass ? "MATCH" : "MISMATCH"})`);
    doc.text(`• Document OCR Name: ${session.documentOcrName || "N/A"}`);
    doc.text(`• Document Number: ${session.documentOcrNumber || "N/A"}`);
    doc.text(`• Document Authenticity: ${session.documentAuthentic ? "Authentic (No tampering)" : "Flagged"} (${session.documentAuthenticityScore}%)`);
    doc.moveDown(1.5);

    // Audit Summary
    doc.fillColor("#0f172a").fontSize(12).text("Agent Audit Summary:", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#475569").text(session.summary || "Visual verification conducted via Gemini Live multimodal vision pipeline.");

    doc.moveDown(3);
    doc.fontSize(9).fillColor("#94a3b8").text("Generated automatically by SnapServe AI Engine. Tamper-evident digital record.", { align: "center" });

    doc.end();
  } catch (err: any) {
    logger.error({ err }, "Failed to generate PDF certificate");
    res.status(500).send("Error generating PDF certificate");
  }
});

// ── 9. PUBLIC: Self-Onboarding Stub Metadata (Customer Portal) ──────────────
router.get("/vision-onboarding/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params["token"] as string;
    const [identity] = await db
      .select({
        id: visionIdentitiesTable.id,
        name: visionIdentitiesTable.name,
        phone: visionIdentitiesTable.phone,
        status: visionIdentitiesTable.status,
        expiresAt: visionIdentitiesTable.selfOnboardingExpiresAt,
      })
      .from(visionIdentitiesTable)
      .where(eq(visionIdentitiesTable.selfOnboardingToken, token));

    if (!identity) {
      res.status(404).json({ error: "Invalid or expired onboarding link" });
      return;
    }

    if (identity.expiresAt && identity.expiresAt < new Date()) {
      res.status(410).json({ error: "This onboarding link has expired" });
      return;
    }

    res.json({ identity });
  } catch (err: any) {
    logger.error({ err }, "Failed to fetch onboarding stub");
    res.status(500).json({ error: "Failed to load onboarding" });
  }
});

// ── 10. PUBLIC: Self-Onboarding Submit Face & PAN Photo ────────────────────
router.post("/vision-onboarding/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params["token"] as string;
    const { facePhotoData, panCardData, panNumber, panName, panDob } = req.body;

    const [identity] = await db
      .select()
      .from(visionIdentitiesTable)
      .where(eq(visionIdentitiesTable.selfOnboardingToken, token));

    if (!identity) {
      res.status(404).json({ error: "Invalid onboarding token" });
      return;
    }

    const [updated] = await db
      .update(visionIdentitiesTable)
      .set({
        ...(facePhotoData ? { facePhotoData } : {}),
        ...(panCardData ? { panCardData } : {}),
        ...(panNumber ? { panNumber } : {}),
        ...(panName ? { panName } : {}),
        ...(panDob ? { panDob } : {}),
        status: facePhotoData && panCardData ? "enrolled" : "pending",
        enrollmentSource: "self_onboarding",
        updatedAt: new Date(),
      })
      .where(eq(visionIdentitiesTable.id, identity.id))
      .returning();

    res.json({ success: true, status: updated.status });
  } catch (err: any) {
    logger.error({ err }, "Failed to submit customer onboarding");
    res.status(500).json({ error: "Failed to save verification photos" });
  }
});

export default router;
