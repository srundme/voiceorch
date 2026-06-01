/**
 * Webcall callback notification service
 * ──────────────────────────────────────────────────────────────────────────────
 * When the callback poller detects a due webcall callback (toNumber starts with
 * "webcall:"), it calls `pushWebcallCallback` to notify any open SSE streams
 * belonging to that user.  The dashboard subscribes to GET /api/webcall-notify
 * and receives a `callback` event with { callbackId, agentId, agentName }.
 */

import type { Response } from "express";
import { logger } from "../lib/logger.js";

interface PendingCallback {
  callbackId: number;
  agentId: number;
  agentName: string;
}

// userId → set of SSE response objects
const sseClients = new Map<string, Set<Response>>();

export function registerSseClient(userId: string, res: Response): () => void {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId)!.add(res);
  logger.info({ userId }, "Webcall-notify SSE client registered");

  return () => {
    sseClients.get(userId)?.delete(res);
    if (sseClients.get(userId)?.size === 0) sseClients.delete(userId);
    logger.info({ userId }, "Webcall-notify SSE client disconnected");
  };
}

export function pushWebcallCallback(userId: string, payload: PendingCallback): void {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) {
    logger.info({ userId, payload }, "Webcall-notify: no SSE clients online for user");
    return;
  }
  const data = JSON.stringify(payload);
  for (const res of clients) {
    try {
      res.write(`event: callback\ndata: ${data}\n\n`);
    } catch (err) {
      logger.warn({ userId, err }, "Webcall-notify SSE write failed");
    }
  }
  logger.info({ userId, callbackId: payload.callbackId, agentId: payload.agentId }, "Webcall-notify pushed to SSE clients");
}
