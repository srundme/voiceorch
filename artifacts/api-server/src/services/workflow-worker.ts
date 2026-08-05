/**
 * Background worker for the workflow engine.
 *
 * Every tick it (1) resumes runs waiting on a completed call, and (2) resumes
 * runs whose delay timer elapsed. Follows the same DB-table + setInterval
 * pattern as batchScheduler / callbackScheduler so it survives restarts
 * without a job queue.
 */

import { logger } from "../lib/logger.js";
import { resumeWaitingCallRuns, resumeDelayedRuns } from "./workflow-engine.js";
import { tickLiveCallPlans } from "./call-plan-sheet-live.js";
import { tickCallPlanAutoFeed } from "./call-plan-queue-feed.js";

const TICK_MS = 15_000;
let started = false;

export function startWorkflowWorker(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  setTimeout(() => { void tick(); }, 8_000); // initial kick shortly after boot
  logger.info("workflow-worker started");
}

async function tick(): Promise<void> {
  try { await resumeWaitingCallRuns(); } catch (err) { logger.warn({ err }, "workflow-worker: resume calls failed"); }
  try { await resumeDelayedRuns(); } catch (err) { logger.warn({ err }, "workflow-worker: resume delays failed"); }
  try { await tickLiveCallPlans(); } catch (err) { logger.warn({ err }, "workflow-worker: call-plan live failed"); }
  try { await tickCallPlanAutoFeed(); } catch (err) { logger.warn({ err }, "workflow-worker: call-plan auto-feed failed"); }
}
