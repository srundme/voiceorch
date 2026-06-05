import type { Request, Response, NextFunction } from "express";

/**
 * Enforce an authenticated platform session. `attachSession` (app-level) has
 * already validated the token and set `req.clerkUserId` to the Google account
 * subject id; here we simply require its presence.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as unknown as { clerkUserId?: string }).clerkUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
