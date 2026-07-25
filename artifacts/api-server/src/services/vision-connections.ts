import { eq, and } from "drizzle-orm";
import { db, visionConnectionsTable } from "@workspace/db";
import type { VisionConnection } from "@workspace/db";
import { logger } from "../lib/logger.js";

export type { VisionConnection };

export async function listConnections(agentId: number): Promise<VisionConnection[]> {
  return db
    .select()
    .from(visionConnectionsTable)
    .where(eq(visionConnectionsTable.agentId, agentId))
    .orderBy(visionConnectionsTable.createdAt);
}

export async function createConnection(
  agentId: number,
  userId: string,
  data: {
    name: string;
    description?: string | null;
    type: string;
    active?: boolean;
    config?: Record<string, unknown>;
  },
): Promise<VisionConnection> {
  const [row] = await db
    .insert(visionConnectionsTable)
    .values({
      agentId,
      userId,
      name: data.name,
      description: data.description ?? null,
      type: data.type,
      active: data.active ?? true,
      config: (data.config ?? {}) as Record<string, unknown>,
    })
    .returning();
  if (!row) throw new Error("Failed to create connection");
  return row;
}

export async function updateConnection(
  id: number,
  data: Partial<Pick<VisionConnection, "name" | "description" | "type" | "active" | "config">>,
): Promise<VisionConnection> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) patch["name"] = data.name;
  if (data.description !== undefined) patch["description"] = data.description;
  if (data.type !== undefined) patch["type"] = data.type;
  if (data.active !== undefined) patch["active"] = data.active;
  if (data.config !== undefined) patch["config"] = data.config;

  const [row] = await db
    .update(visionConnectionsTable)
    .set(patch as typeof visionConnectionsTable.$inferInsert)
    .where(eq(visionConnectionsTable.id, id))
    .returning();
  if (!row) throw new Error("Connection not found");
  return row;
}

export async function deleteConnection(id: number): Promise<void> {
  await db
    .delete(visionConnectionsTable)
    .where(eq(visionConnectionsTable.id, id));
}

export async function testConnection(
  id: number,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const [conn] = await db
    .select()
    .from(visionConnectionsTable)
    .where(eq(visionConnectionsTable.id, id))
    .limit(1);

  if (!conn) return { ok: false, latencyMs: 0, error: "Connection not found" };

  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const start = Date.now();

  try {
    if (conn.type === "webhook" || conn.type === "rest_api") {
      const url = String(cfg["url"] ?? "");
      if (!url) return { ok: false, latencyMs: 0, error: "No URL configured" };

      const method = conn.type === "rest_api"
        ? String(cfg["method"] ?? "GET")
        : "POST";

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(cfg["headers"] as Record<string, string> | undefined ?? {}),
      };

      const authType = String(cfg["authType"] ?? "none");
      if (authType === "bearer" && cfg["authValue"]) {
        headers["Authorization"] = `Bearer ${cfg["authValue"]}`;
      } else if (authType === "api_key" && cfg["authValue"]) {
        headers["X-API-Key"] = String(cfg["authValue"]);
      }

      const response = await fetch(url, {
        method,
        headers,
        body: method !== "GET" ? JSON.stringify({ test: true }) : undefined,
        signal: AbortSignal.timeout(10000),
      });
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        await db
          .update(visionConnectionsTable)
          .set({ lastError: `HTTP ${response.status}: ${errText.slice(0, 200)}`, updatedAt: new Date() })
          .where(eq(visionConnectionsTable.id, id));
        return { ok: false, latencyMs, error: `HTTP ${response.status}` };
      }

      await db
        .update(visionConnectionsTable)
        .set({ lastUsedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(visionConnectionsTable.id, id));

      return { ok: true, latencyMs };
    }

    return { ok: false, latencyMs: 0, error: `Connection type '${conn.type}' test not supported` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ id, err }, "vision-connections: testConnection error");
    await db
      .update(visionConnectionsTable)
      .set({ lastError: error.slice(0, 500), updatedAt: new Date() })
      .where(eq(visionConnectionsTable.id, id));
    return { ok: false, latencyMs, error };
  }
}

export async function fireWebhook(
  connectionId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const [conn] = await db
    .select()
    .from(visionConnectionsTable)
    .where(and(eq(visionConnectionsTable.id, connectionId), eq(visionConnectionsTable.active, true)))
    .limit(1);

  if (!conn || conn.type !== "webhook") {
    logger.warn({ connectionId }, "vision-connections: fireWebhook skipped — not found or wrong type");
    return;
  }

  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const url = String(cfg["url"] ?? "");
  if (!url) {
    logger.warn({ connectionId }, "vision-connections: webhook has no URL");
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(cfg["headers"] as Record<string, string> | undefined ?? {}),
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      logger.warn({ connectionId, status: response.status }, "vision-connections: webhook returned non-2xx");
    } else {
      await db
        .update(visionConnectionsTable)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(visionConnectionsTable.id, connectionId));
    }
  } catch (err) {
    logger.error({ connectionId, err }, "vision-connections: fireWebhook failed");
  }
}

export async function callRestApi(
  connectionId: number,
  variables: Record<string, unknown>,
): Promise<string> {
  const [conn] = await db
    .select()
    .from(visionConnectionsTable)
    .where(and(eq(visionConnectionsTable.id, connectionId), eq(visionConnectionsTable.active, true)))
    .limit(1);

  if (!conn || conn.type !== "rest_api") {
    throw new Error(`Connection ${connectionId} not found or not a REST API connection`);
  }

  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const url = String(cfg["url"] ?? "");
  if (!url) throw new Error("REST API connection has no URL configured");

  const method = String(cfg["method"] ?? "POST");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(cfg["headers"] as Record<string, string> | undefined ?? {}),
  };

  const authType = String(cfg["authType"] ?? "none");
  if (authType === "bearer" && cfg["authValue"]) {
    headers["Authorization"] = `Bearer ${cfg["authValue"]}`;
  } else if (authType === "api_key" && cfg["authValue"]) {
    headers["X-API-Key"] = String(cfg["authValue"]);
  }

  // Apply body template if configured
  let body: string;
  if (cfg["bodyTemplate"]) {
    let tmpl = String(cfg["bodyTemplate"]);
    for (const [k, v] of Object.entries(variables)) {
      tmpl = tmpl.replaceAll(`{{${k}}}`, String(v));
    }
    body = tmpl;
  } else {
    body = JSON.stringify(variables);
  }

  const response = await fetch(url, {
    method,
    headers,
    body: method !== "GET" ? body : undefined,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`REST API ${response.status}: ${errText.slice(0, 500)}`);
  }

  await db
    .update(visionConnectionsTable)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(visionConnectionsTable.id, connectionId));

  const responseText = await response.text();

  // Apply response mapping if configured
  const responseMapping = cfg["responseMapping"] as Record<string, string> | undefined;
  if (responseMapping) {
    try {
      const json = JSON.parse(responseText) as Record<string, unknown>;
      const mapped: Record<string, unknown> = {};
      for (const [path, varName] of Object.entries(responseMapping)) {
        const val = path.split(".").reduce<unknown>((obj, key) =>
          (obj && typeof obj === "object") ? (obj as Record<string, unknown>)[key] : undefined, json);
        mapped[varName] = val;
      }
      return JSON.stringify(mapped);
    } catch {
      // fall through to raw text
    }
  }

  return responseText;
}
