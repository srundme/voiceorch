/**
 * Unauthenticated partner white-label endpoints.
 *
 * Mounted before any router.use(requireAuth) in routes/index.ts — Express runs
 * that middleware for every request that enters a prefix-less router, so these
 * would otherwise 401 and the custom-domain login page would fall back to
 * SnapServe chrome.
 */
import { Router } from "express";
import { db, partnersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getPartnerCnameTarget,
  getPartnerSubdomainRoot,
  resolvePartnerByHost,
} from "../services/partner-domains.js";

const TOKEN_RE = /^[0-9a-f]{24,64}$/i;

const router: Router = Router();

/** Public: clients' dashboards load the partner logo from this URL. */
router.get("/public/partner-logos/:token", async (req, res): Promise<void> => {
  try {
    const token = String((req.params as { token?: string }).token ?? "");
    if (!TOKEN_RE.test(token)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [partner] = await db
      .select({ logoData: partnersTable.logoData, logoMime: partnersTable.logoMime })
      .from(partnersTable)
      .where(eq(partnersTable.logoToken, token));
    if (!partner?.logoData || !partner.logoMime) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Content-Type", partner.logoMime);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(partner.logoData);
  } catch (err) {
    req.log.error({ err }, "public partner logo failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Public: resolve partner branding from the browser Host (login / pre-auth). */
router.get("/public/partner-branding", async (req, res): Promise<void> => {
  try {
    const hostRaw =
      (typeof req.query["host"] === "string" && req.query["host"]) ||
      (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ||
      req.hostname;
    const brand = await resolvePartnerByHost(String(hostRaw ?? ""));
    if (!brand) {
      res.json({ branding: null, subdomainRoot: getPartnerSubdomainRoot(), cnameTarget: getPartnerCnameTarget() });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      branding: brand,
      subdomainRoot: getPartnerSubdomainRoot(),
      cnameTarget: getPartnerCnameTarget(),
    });
  } catch (err) {
    req.log.error({ err }, "public partner branding failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
