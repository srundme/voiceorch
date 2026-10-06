/**
 * Preconditions for starting AI Test Calls. DB access goes through `deps` so
 * the rules are unit-testable without Postgres.
 */

import { and, eq, isNull, ne } from "drizzle-orm";
import { db, pool, phoneNumbersTable, usersTable, type agentsTable } from "@workspace/db";
import { resolveAgentBillingMode, resolveBillingRateCentsPerMin, resolveOwnTelephonyDiscount } from "../minute-rates.js";
import { resolvePartnerBilling } from "../partner-billing.js";
import { estimateRunCostCents, SLOTS_PER_RUN } from "./policy.js";

export class TestRunPreconditionError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 400) {
    super(message);
    this.name = "TestRunPreconditionError";
  }
}

type TargetAgent = Pick<
  typeof agentsTable.$inferSelect,
  "id" | "userId" | "asrProvider" | "llmProvider" | "ttsProvider" | "telephonyProvider"
>;

export interface InboundNumberRow {
  id: number;
  number: string;
  userId: string;
  routingRules: unknown;
  squadId: number | null;
}

export interface PreconditionDeps {
  findInboundNumbers(agentId: number): Promise<InboundNumberRow[]>;
  walletBalanceCents(userId: string): Promise<number | null>;
  concurrentLimit(userId: string): Promise<number>;
  activeCallSlots(userId: string): Promise<number>;
  rateCentsPerMin(userId: string, agent: Omit<TargetAgent, "id" | "userId">): Promise<number>;
}

/** The persona leg always runs on the managed Sarvam stack. */
export function personaBillingShape(target: TargetAgent): Omit<TargetAgent, "id" | "userId"> {
  return { asrProvider: "sarvam", llmProvider: "sarvam", ttsProvider: "sarvam", telephonyProvider: target.telephonyProvider };
}

export function pickTestableInboundNumber(rows: InboundNumberRow[], ownerUserId: string): InboundNumberRow {
  if (rows.length === 0) {
    throw new TestRunPreconditionError(
      "Assign an inbound phone number to this agent first — test calls dial the agent's own number.",
      "NO_INBOUND_NUMBER",
    );
  }
  const owned = rows.filter((r) => r.userId === ownerUserId);
  if (owned.length === 0) {
    throw new TestRunPreconditionError(
      "The phone number on this agent belongs to another account, so test calls can't use it.",
      "INBOUND_NUMBER_NOT_OWNED",
    );
  }
  const direct = owned.find((r) => r.squadId == null && !(Array.isArray(r.routingRules) && r.routingRules.length > 0));
  if (!direct) {
    throw new TestRunPreconditionError(
      "This agent's number routes calls elsewhere (routing rules or a squad). Use a number that rings this agent directly.",
      "INBOUND_NUMBER_ROUTED",
    );
  }
  return direct;
}

export interface TestSetup {
  inboundNumber: InboundNumberRow;
  callerRateCentsPerMin: number;
  targetRateCentsPerMin: number;
  walletBalanceCents: number;
  estimatedCostCents: number;
}

export async function checkRunPreconditions(
  opts: { target: TargetAgent; maxDurations: number[] },
  deps: PreconditionDeps = defaultPreconditionDeps,
): Promise<TestSetup> {
  const { target } = opts;
  const userId = target.userId;
  if (!userId) throw new TestRunPreconditionError("Agent has no owner", "NO_OWNER");

  const inboundNumber = pickTestableInboundNumber(await deps.findInboundNumbers(target.id), userId);

  const [callerRateCentsPerMin, targetRateCentsPerMin, wallet] = await Promise.all([
    deps.rateCentsPerMin(userId, personaBillingShape(target)),
    deps.rateCentsPerMin(userId, target),
    deps.walletBalanceCents(userId),
  ]);
  const estimatedCostCents = opts.maxDurations.reduce(
    (sum, maxDurationSeconds) => sum + estimateRunCostCents({ maxDurationSeconds, callerRateCentsPerMin, targetRateCentsPerMin }),
    0,
  );
  const walletBalanceCents = wallet ?? 0;
  if (walletBalanceCents <= 0 || walletBalanceCents < estimatedCostCents) {
    throw new TestRunPreconditionError(
      `Insufficient balance. These test calls can cost up to ₹${(estimatedCostCents / 100).toFixed(2)} (both call legs are billed). Top up your wallet or run fewer tests.`,
      "INSUFFICIENT_BALANCE",
      402,
    );
  }

  const [limit, active] = await Promise.all([deps.concurrentLimit(userId), deps.activeCallSlots(userId)]);
  if (active + SLOTS_PER_RUN > limit) {
    throw new TestRunPreconditionError(
      `Not enough free call slots: a test call needs ${SLOTS_PER_RUN} (you have ${Math.max(0, limit - active)} of ${limit} free). Try again when current calls end.`,
      "NO_CALL_SLOTS",
      409,
    );
  }

  return { inboundNumber, callerRateCentsPerMin, targetRateCentsPerMin, walletBalanceCents, estimatedCostCents };
}

export async function resolveAgentRateCentsPerMin(
  userId: string,
  agent: Omit<TargetAgent, "id" | "userId">,
): Promise<number> {
  const partner = await resolvePartnerBilling(userId);
  if (partner?.clientRateCentsPerMin != null) return partner.clientRateCentsPerMin;
  const mode = await resolveAgentBillingMode(userId, agent);
  return Math.max(0, (await resolveBillingRateCentsPerMin(mode)) - await resolveOwnTelephonyDiscount(userId, agent));
}

export async function countActiveCallSlots(userId: string): Promise<number> {
  try {
    const r = await pool.query(
      "SELECT count(*)::int AS n FROM voice_call_leases WHERE tenant=$1 AND expires_at > now()",
      [userId],
    );
    return Number(r.rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

export const defaultPreconditionDeps: PreconditionDeps = {
  async findInboundNumbers(agentId) {
    return db
      .select({
        id: phoneNumbersTable.id,
        number: phoneNumbersTable.number,
        userId: phoneNumbersTable.userId,
        routingRules: phoneNumbersTable.routingRules,
        squadId: phoneNumbersTable.squadId,
      })
      .from(phoneNumbersTable)
      .where(and(
        eq(phoneNumbersTable.agentId, agentId),
        eq(phoneNumbersTable.status, "active"),
        ne(phoneNumbersTable.service, "whatsapp"),
        isNull(phoneNumbersTable.releasedAt),
      ));
  },
  async walletBalanceCents(userId) {
    const [u] = await db
      .select({ walletBalanceCents: usersTable.walletBalanceCents })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    return u?.walletBalanceCents ?? null;
  },
  async concurrentLimit(userId) {
    const { getUserConcurrentLimit } = await import("../workflow-dial-queue.js");
    return getUserConcurrentLimit(userId);
  },
  activeCallSlots: countActiveCallSlots,
  rateCentsPerMin: resolveAgentRateCentsPerMin,
};
