import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { extractTextFromUpload } from "../services/prompt-template.js";
import {
  SINGLETON_TYPES,
  type SystemTemplateType,
  type TemplateGroup,
  insertVersion,
  activateVersion,
  listGroupedTemplates,
  getVersionDetail,
  getDomain,
  createDomain,
  renameDomain,
  deleteDomain,
} from "../services/system-prompt-template.js";
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

router.use("/admin/system-prompt-templates", requireAdmin);

function adminLabel(req: Request): string {
  const adminToken = (req.headers["x-admin-token"] as string | undefined) ?? "unknown";
  return `admin:${adminToken.slice(-4)}`;
}

/**
 * Validate + extract text from an uploaded file, throwing a { status, message }
 * shaped error on any validation failure so callers can map it to a response.
 */
async function extractOrThrow(file: Express.Multer.File | undefined): Promise<string> {
  if (!file) {
    throw { status: 400, message: "No file uploaded (expected multipart field 'file')" };
  }
  const lower = file.originalname.toLowerCase();
  const hasGoodExt = ALLOWED_EXTS.some((e) => lower.endsWith(e));
  if (!ALLOWED_MIME.has(file.mimetype) && !hasGoodExt) {
    throw {
      status: 400,
      message: `Unsupported file type: ${file.mimetype}. Allowed: PDF or DOCX (legacy .doc is not supported).`,
    };
  }
  if (lower.endsWith(".doc") && !lower.endsWith(".docx")) {
    throw {
      status: 400,
      message: "Legacy .doc is not supported. Please save as PDF or DOCX and re-upload.",
    };
  }
  const text = await extractTextFromUpload(file.buffer, file.mimetype, file.originalname);
  if (!text || text.length < 20) {
    throw { status: 400, message: "Extracted text is empty or too short." };
  }
  return text;
}

function isHttpError(err: unknown): err is { status: number; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { status?: unknown }).status === "number" &&
    typeof (err as { message?: unknown }).message === "string"
  );
}

// ── GET /admin/system-prompt-templates  (grouped snapshot) ───────────────────
router.get("/admin/system-prompt-templates", async (_req, res): Promise<void> => {
  try {
    const grouped = await listGroupedTemplates();
    res.json(grouped);
  } catch (err) {
    logger.error({ err }, "Failed to list system prompt templates");
    res.status(500).json({ error: "Failed to load templates" });
  }
});

// ── GET /admin/system-prompt-templates/versions/:id  (full extracted text) ───
router.get("/admin/system-prompt-templates/versions/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const row = await getVersionDetail(id);
  if (!row) {
    res.status(404).json({ error: "Template version not found" });
    return;
  }
  res.json(row);
});

// ── POST /admin/system-prompt-templates/versions/:id/activate ────────────────
router.post(
  "/admin/system-prompt-templates/versions/:id/activate",
  async (req, res): Promise<void> => {
    const id = Number(req.params["id"]);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      await activateVersion(id);
      res.json({ ok: true, activeId: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Activation failed";
      res.status(message.includes("not found") ? 404 : 500).json({ error: message });
    }
  },
);

// ── POST /admin/system-prompt-templates/singleton/:type  (upload version) ────
// :type is "foundation" | "client_details"
router.post(
  "/admin/system-prompt-templates/singleton/:type",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const type = req.params["type"] as SystemTemplateType;
    if (!SINGLETON_TYPES.includes(type)) {
      res.status(400).json({ error: `Invalid singleton type: ${type}` });
      return;
    }
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      const text = await extractOrThrow(file);
      const group: TemplateGroup = { type };
      const row = await insertVersion(group, {
        filename: file!.originalname,
        mimeType: file!.mimetype,
        extractedText: text,
        uploadedBy: adminLabel(req),
      });
      res.status(201).json({ ...row, extractedTextLength: text.length });
    } catch (err) {
      if (isHttpError(err)) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "System prompt singleton upload failed");
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(500).json({ error: message });
    }
  },
);

// ── POST /admin/system-prompt-templates/domains  (create domain + first upload)
router.post(
  "/admin/system-prompt-templates/domains",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const name = String((req.body?.name ?? "")).trim();
    if (!name) {
      res.status(400).json({ error: "Domain name is required (multipart field 'name')" });
      return;
    }
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      const text = await extractOrThrow(file);
      const domain = await createDomain(name, adminLabel(req));
      const row = await insertVersion(
        { type: "domain", domainId: domain.id },
        {
          filename: file!.originalname,
          mimeType: file!.mimetype,
          extractedText: text,
          uploadedBy: adminLabel(req),
        },
      );
      res.status(201).json({ domain, version: { ...row, extractedTextLength: text.length } });
    } catch (err) {
      if (isHttpError(err)) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "System prompt domain create failed");
      const message = err instanceof Error ? err.message : "Create failed";
      res.status(500).json({ error: message });
    }
  },
);

// ── POST /admin/system-prompt-templates/domains/:id/versions  (upload version)
router.post(
  "/admin/system-prompt-templates/domains/:id/versions",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const domainId = Number(req.params["id"]);
    if (!Number.isFinite(domainId)) {
      res.status(400).json({ error: "Invalid domain id" });
      return;
    }
    try {
      const domain = await getDomain(domainId);
      if (!domain) {
        res.status(404).json({ error: "Domain not found" });
        return;
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      const text = await extractOrThrow(file);
      const row = await insertVersion(
        { type: "domain", domainId },
        {
          filename: file!.originalname,
          mimeType: file!.mimetype,
          extractedText: text,
          uploadedBy: adminLabel(req),
        },
      );
      res.status(201).json({ ...row, extractedTextLength: text.length });
    } catch (err) {
      if (isHttpError(err)) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      logger.error({ err }, "System prompt domain version upload failed");
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(500).json({ error: message });
    }
  },
);

// ── PATCH /admin/system-prompt-templates/domains/:id  (rename) ───────────────
router.patch(
  "/admin/system-prompt-templates/domains/:id",
  async (req, res): Promise<void> => {
    const domainId = Number(req.params["id"]);
    if (!Number.isFinite(domainId)) {
      res.status(400).json({ error: "Invalid domain id" });
      return;
    }
    const name = String((req.body?.name ?? "")).trim();
    if (!name) {
      res.status(400).json({ error: "Domain name is required" });
      return;
    }
    const row = await renameDomain(domainId, name);
    if (!row) {
      res.status(404).json({ error: "Domain not found" });
      return;
    }
    res.json(row);
  },
);

// ── DELETE /admin/system-prompt-templates/domains/:id ────────────────────────
router.delete(
  "/admin/system-prompt-templates/domains/:id",
  async (req, res): Promise<void> => {
    const domainId = Number(req.params["id"]);
    if (!Number.isFinite(domainId)) {
      res.status(400).json({ error: "Invalid domain id" });
      return;
    }
    const domain = await getDomain(domainId);
    if (!domain) {
      res.status(404).json({ error: "Domain not found" });
      return;
    }
    await deleteDomain(domainId);
    res.json({ ok: true });
  },
);

export default router;
