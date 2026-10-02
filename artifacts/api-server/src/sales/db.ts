import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "@workspace/db/schema";
import { salesAuditTable } from "@workspace/db/schema";
import type { SalesRole } from "./stages.js";

export type SalesDb = PgDatabase<any, typeof schema>;

export interface SalesActor {
  id: number;
  email: string;
  name: string;
  role: SalesRole;
}

export const SYSTEM_ACTOR: SalesActor = { id: 0, email: "system@sales.internal", name: "System", role: "founder" };

export function actorRef(actor: SalesActor): number | null {
  return actor.id > 0 ? actor.id : null;
}

export class SalesError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const forbidden = (message = "You do not have permission to do this"): SalesError => new SalesError(403, message);
export const notFound = (what: string): SalesError => new SalesError(404, `${what} not found`);

export function isFounder(actor: SalesActor): boolean {
  return actor.role === "founder";
}

export interface AuditEntry {
  actorUserId: number | null;
  entity: string;
  entityId: string | number | null;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

export async function writeAudit(db: SalesDb, entry: AuditEntry): Promise<void> {
  await db.insert(salesAuditTable).values({
    actorUserId: entry.actorUserId,
    entity: entry.entity,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
  });
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  if (code !== "23505") return false;
  if (!constraint) return true;
  const name = e?.constraint ?? e?.cause?.constraint;
  return name === undefined || name === constraint;
}
