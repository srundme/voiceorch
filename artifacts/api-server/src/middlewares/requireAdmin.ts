import type { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"] as string | undefined;
  const adminToken = process.env["ADMIN_TOKEN"];

  if (!adminToken) {
    res.status(503).json({ error: "Admin access not configured" });
    return;
  }
  if (!token || token !== adminToken) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
