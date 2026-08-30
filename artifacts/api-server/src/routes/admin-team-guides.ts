import { Router, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use("/admin/team-guides", requireAdmin);

const GUIDES = {
  "portal-button-guide": {
    filename: "SnapServe-Portal-Button-Guide.pdf",
    title: "Portal Button Guide",
  },
  "team-qa-prep": {
    filename: "SnapServe-Team-QA-Prep.pdf",
    title: "Team Q&A Prep",
  },
  "architecture-cheat-sheet": {
    filename: "SnapServe-Webinar-Architecture-Cheat-Sheet.pdf",
    title: "Architecture Cheat Sheet",
  },
} as const;

type GuideId = keyof typeof GUIDES;

function resolveGuideFile(filename: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), "docs", "webinar", filename),
    path.resolve(process.cwd(), "..", "..", "docs", "webinar", filename),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

router.get("/admin/team-guides", (_req, res): void => {
  res.json(
    Object.entries(GUIDES).map(([id, guide]) => ({
      id,
      title: guide.title,
      filename: guide.filename,
    })),
  );
});

router.get("/admin/team-guides/:id.pdf", (req, res: Response): void => {
  const id = req.params["id"] as GuideId;
  const guide = GUIDES[id];
  if (!guide) {
    res.status(404).json({ error: "Guide not found" });
    return;
  }

  const filePath = resolveGuideFile(guide.filename);
  if (!filePath) {
    logger.error({ guideId: id, filename: guide.filename }, "Admin team guide PDF missing");
    res.status(503).json({ error: "Guide is not available in this deployment" });
    return;
  }

  res.download(filePath, guide.filename, (error) => {
    if (error && !res.headersSent) {
      logger.error({ error, guideId: id }, "Admin team guide download failed");
      res.status(500).json({ error: "Could not download guide" });
    }
  });
});

export default router;
