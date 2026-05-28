import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { db, promptTemplatesTable, agentsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import {
  extractTextFromUpload,
  getNextVersion,
  activateTemplate,
  listTemplates,
  getActiveTemplate,
  generateAgentPrompt,
  DUMMY_PREVIEW_PAYLOAD,
  type WizardInputs,
} from "../services/prompt-template.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream", // some browsers send this for .docx
]);
const ALLOWED_EXTS = [".pdf", ".docx"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

router.use("/admin/prompt-templates", requireAdmin);

// ── POST /admin/prompt-templates  (multipart upload) ─────────────────────────
router.post(
  "/admin/prompt-templates",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: "No file uploaded (expected multipart field 'file')" });
        return;
      }
      const lower = file.originalname.toLowerCase();
      const hasGoodExt = ALLOWED_EXTS.some((e) => lower.endsWith(e));
      if (!ALLOWED_MIME.has(file.mimetype) && !hasGoodExt) {
        res.status(400).json({
          error: `Unsupported file type: ${file.mimetype}. Allowed: PDF or DOCX (legacy .doc is not supported).`,
        });
        return;
      }
      // Hard-reject legacy .doc — mammoth only handles OOXML (.docx)
      if (lower.endsWith(".doc") && !lower.endsWith(".docx")) {
        res.status(400).json({
          error: "Legacy .doc is not supported. Please save as PDF or DOCX and re-upload.",
        });
        return;
      }

      const text = await extractTextFromUpload(file.buffer, file.mimetype, file.originalname);
      if (!text || text.length < 20) {
        res.status(400).json({ error: "Extracted text is empty or too short." });
        return;
      }

      const version = await getNextVersion();
      const adminToken = (req.headers["x-admin-token"] as string | undefined) ?? "unknown";
      const uploadedBy = `admin:${adminToken.slice(-4)}`;

      const inserted = await db.transaction(async (tx) => {
        await tx
          .update(promptTemplatesTable)
          .set({ isActive: false })
          .where(eq(promptTemplatesTable.isActive, true));
        const [row] = await tx
          .insert(promptTemplatesTable)
          .values({
            version,
            filename: file.originalname,
            mimeType: file.mimetype,
            extractedText: text,
            uploadedBy,
            isActive: true,
          })
          .returning();
        return row;
      });

      res.status(201).json({
        id: inserted!.id,
        version: inserted!.version,
        filename: inserted!.filename,
        mimeType: inserted!.mimeType,
        uploadedBy: inserted!.uploadedBy,
        uploadedAt: inserted!.uploadedAt,
        isActive: inserted!.isActive,
        extractedTextLength: text.length,
      });
    } catch (err) {
      logger.error({ err }, "Prompt template upload failed");
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(500).json({ error: message });
    }
  },
);

// ── GET /admin/prompt-templates ──────────────────────────────────────────────
router.get("/admin/prompt-templates", async (_req, res): Promise<void> => {
  const rows = await listTemplates();
  res.json(rows);
});

// ── GET /admin/prompt-templates/:id ──────────────────────────────────────────
router.get("/admin/prompt-templates/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(promptTemplatesTable)
    .where(eq(promptTemplatesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(row);
});

// ── POST /admin/prompt-templates/:id/activate ────────────────────────────────
router.post("/admin/prompt-templates/:id/activate", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(promptTemplatesTable)
    .where(eq(promptTemplatesTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  await activateTemplate(id);
  res.json({ ok: true, activeId: id, version: row.version });
});

// ── POST /admin/prompt-templates/preview ─────────────────────────────────────
router.post("/admin/prompt-templates/preview", async (req, res): Promise<void> => {
  try {
    const active = await getActiveTemplate();
    if (!active) {
      res.status(400).json({ error: "No active prompt template — upload one first." });
      return;
    }
    const body = (req.body ?? {}) as { wizardInputs?: WizardInputs };
    const inputs = body.wizardInputs ?? DUMMY_PREVIEW_PAYLOAD;
    const prompt = await generateAgentPrompt(inputs, active.extractedText);
    res.json({
      prompt,
      templateVersion: active.version,
      templateId: active.id,
      filename: active.filename,
    });
  } catch (err) {
    logger.error({ err }, "Prompt preview failed");
    const message = err instanceof Error ? err.message : "Preview failed";
    res.status(500).json({ error: message });
  }
});

// ── Admin: All agents (platform-wide) ────────────────────────────────────────

router.use("/admin/agents", requireAdmin);

router.get("/admin/agents", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      agentType: agentsTable.agentType,
      userId: agentsTable.userId,
      status: agentsTable.status,
      systemPrompt: agentsTable.systemPrompt,
      generatedPrompt: agentsTable.generatedPrompt,
      promptTemplateVersion: agentsTable.promptTemplateVersion,
      wizardInputs: agentsTable.wizardInputs,
      createdAt: agentsTable.createdAt,
    })
    .from(agentsTable)
    .orderBy(desc(agentsTable.createdAt));

  // owner / company come from wizard inputs when available
  const result = rows.map((r) => {
    const wi = (r.wizardInputs ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      name: r.name,
      agentType: r.agentType,
      ownerUserId: r.userId,
      company: (wi["companyName"] as string | undefined) ?? null,
      status: r.status,
      promptTemplateVersion: r.promptTemplateVersion,
      hasGeneratedPrompt: !!r.generatedPrompt,
      hasWizardInputs: !!r.wizardInputs,
      createdAt: r.createdAt,
    };
  });

  res.json(result);
});

router.get("/admin/agents/:id/prompt", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      systemPrompt: agentsTable.systemPrompt,
      generatedPrompt: agentsTable.generatedPrompt,
      promptTemplateVersion: agentsTable.promptTemplateVersion,
      wizardInputs: agentsTable.wizardInputs,
    })
    .from(agentsTable)
    .where(eq(agentsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json(row);
});

router.post("/admin/agents/:id/regenerate", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, id));
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (!agent.wizardInputs) {
      res.status(400).json({
        error: "Agent has no stored wizard inputs — regeneration is unavailable.",
      });
      return;
    }
    const active = await getActiveTemplate();
    if (!active) {
      res.status(400).json({ error: "No active prompt template — upload one first." });
      return;
    }
    const generated = await generateAgentPrompt(
      agent.wizardInputs as WizardInputs,
      active.extractedText,
    );
    const [updated] = await db
      .update(agentsTable)
      .set({
        generatedPrompt: generated,
        promptTemplateVersion: active.version,
        updatedAt: new Date(),
      })
      .where(eq(agentsTable.id, id))
      .returning();

    res.json({
      id: updated!.id,
      generatedPrompt: updated!.generatedPrompt,
      promptTemplateVersion: updated!.promptTemplateVersion,
    });
  } catch (err) {
    logger.error({ err, id }, "Agent prompt regeneration failed");
    const message = err instanceof Error ? err.message : "Regeneration failed";
    res.status(500).json({ error: message });
  }
});

export default router;
