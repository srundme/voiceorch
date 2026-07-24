import { randomBytes } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, webcallLinksTable, agentsTable, type WebcallLink } from "@workspace/db";

export function mintWebcallLinkToken(): string {
  return `wcl_${randomBytes(18).toString("hex")}`;
}

export function isWebcallLinkUsable(link: WebcallLink): { ok: true } | { ok: false; reason: string } {
  if (!link.active) return { ok: false, reason: "This link has been deactivated." };
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "This link has expired." };
  }
  if (link.maxUses != null && link.useCount >= link.maxUses) {
    return { ok: false, reason: "This link has reached its maximum number of uses." };
  }
  return { ok: true };
}

export async function getWebcallLinkByToken(token: string): Promise<WebcallLink | null> {
  const cleaned = token.trim();
  if (!cleaned) return null;
  const [row] = await db
    .select()
    .from(webcallLinksTable)
    .where(eq(webcallLinksTable.token, cleaned))
    .limit(1);
  return row ?? null;
}

/** Resolve a share token for WS upgrade — validates usability + agent match. */
export async function resolveShareTokenForWebcall(
  token: string,
  agentId: number,
): Promise<
  | { ok: true; link: WebcallLink; ownerUserId: string }
  | { ok: false; status: number; error: string }
> {
  const link = await getWebcallLinkByToken(token);
  if (!link) return { ok: false, status: 401, error: "Invalid share link" };
  if (link.agentId !== agentId) {
    return { ok: false, status: 403, error: "Share link does not match this agent" };
  }
  const usable = isWebcallLinkUsable(link);
  if (!usable.ok) return { ok: false, status: 403, error: usable.reason };

  const [agent] = await db
    .select({ userId: agentsTable.userId, name: agentsTable.name, status: agentsTable.status })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1);
  if (!agent?.userId) return { ok: false, status: 404, error: "Agent not found" };
  if (agent.userId !== link.userId) {
    return { ok: false, status: 403, error: "Share link ownership mismatch" };
  }

  return { ok: true, link, ownerUserId: agent.userId };
}

export async function recordWebcallLinkUse(linkId: number): Promise<void> {
  await db
    .update(webcallLinksTable)
    .set({
      useCount: sql`${webcallLinksTable.useCount} + 1`,
      lastUsedAt: new Date(),
    })
    .where(and(eq(webcallLinksTable.id, linkId)));
}
