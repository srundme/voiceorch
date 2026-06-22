import type { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"] as string | undefined;
  const adminToken = process.env["ADMIN_TOKEN"];
  const superAdminToken = process.env["SUPER_ADMIN_TOKEN"];

  if (!adminToken) {
    res.status(503).json({ error: "Admin access not configured" });
    return;
  }
  // Accept either ADMIN_TOKEN or SUPER_ADMIN_TOKEN (if configured) so that
  // super-admin token holders can also access all admin endpoints.
  const validTokens = new Set([adminToken]);
  if (superAdminToken) validTokens.add(superAdminToken);

  if (!token || !validTokens.has(token)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
