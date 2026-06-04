/**
 * Do Not Call (DNC) registry helpers
 */

import { db, workspaceDncTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { normalizePhone } from "./phone-normalize.js";

export async function isOnDnc(userId: string, rawPhone: string): Promise<boolean> {
  const normalized = normalizePhone(rawPhone);
  const [row] = await db.select({ id: workspaceDncTable.id })
    .from(workspaceDncTable)
    .where(and(
      eq(workspaceDncTable.userId, userId),
      eq(workspaceDncTable.normalizedPhone, normalized),
      eq(workspaceDncTable.isActive, true),
    ))
    .limit(1);
  return !!row;
}

export async function addToDnc(userId: string, rawPhone: string, reason?: string): Promise<void> {
  const normalized = normalizePhone(rawPhone);
  await db.insert(workspaceDncTable)
    .values({ userId, phone: rawPhone, normalizedPhone: normalized, reason: reason ?? null })
    .onConflictDoNothing();
}
