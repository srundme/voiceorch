import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, walletTransactionsTable, phoneNumbersTable, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logActivity } from "../lib/activity.js";
import {
  ListPhoneNumbersResponse,
  ListAvailablePhoneNumbersQueryParams,
  ListAvailablePhoneNumbersResponse,
  PurchasePhoneNumberBody,
  AssignPhoneNumberParams,
  AssignPhoneNumberBody,
  AssignPhoneNumberResponse,
  ReleasePhoneNumberParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const PHONE_NUMBER_COST_CENTS = 500; // $5.00

// ── Platform-level Vobiz credentials ────────────────────────────────────────
function getPlatformVobizCreds() {
  const authId    = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  return { authId, authToken, configured: !!(authId && authToken) };
}

function vobizBase(authId: string) {
  return `https://api.vobiz.ai/api/v1/Account/${authId}`;
}

function vobizHeaders(authId: string, authToken: string) {
  return {
    "X-Auth-ID":    authId,
    "X-Auth-Token": authToken,
    "Content-Type": "application/json",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function enrichNumber(row: typeof phoneNumbersTable.$inferSelect) {
  let agentName: string | null = null;
  if (row.agentId) {
    const [ag] = await db.select({ name: agentsTable.name }).from(agentsTable).where(eq(agentsTable.id, row.agentId));
    agentName = ag?.name ?? null;
  }
  return {
    ...row,
    agentName,
    purchasedAt:  row.purchasedAt.toISOString(),
    releasedAt:   row.releasedAt?.toISOString() ?? null,
    createdAt:    row.createdAt.toISOString(),
  };
}

// ── GET /phone-numbers ────────────────────────────────────────────────────────

router.get("/phone-numbers", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.userId, clerkId), eq(phoneNumbersTable.status, "active")));
  const enriched = await Promise.all(rows.map(enrichNumber));
  res.json(ListPhoneNumbersResponse.parse(enriched));
});

// ── GET /phone-numbers/available ──────────────────────────────────────────────

router.get("/phone-numbers/available", requireAuth, async (req, res): Promise<void> => {
  const query = ListAvailablePhoneNumbersQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const { authId, authToken, configured } = getPlatformVobizCreds();

  if (!configured) {
    res.status(503).json({ error: "Platform carrier credentials not configured.", code: "PLATFORM_NOT_CONFIGURED" });
    return;
  }

  const { countryCode, numberType, pattern } = query.data;
  const typeMap: Record<string, string> = { local: "LOCAL", toll_free: "TOLLFREE", mobile: "MOBILE" };
  const vobizType = typeMap[numberType] ?? "LOCAL";

  let url = `${vobizBase(authId!)}/AvailablePhoneNumber/${countryCode.toUpperCase()}/?type=${vobizType}&limit=20`;
  if (pattern) url += `&pattern=${encodeURIComponent(pattern)}`;

  try {
    const resp = await fetch(url, { headers: vobizHeaders(authId!, authToken!) });
    if (!resp.ok) {
      const err = await resp.text();
      req.log.warn({ status: resp.status, err }, "Vobiz available numbers error");
      res.json([]);
      return;
    }

    const data = await resp.json() as { objects?: Array<{ number: string; region?: string; type?: string; monthly_rental_rate?: string }> };
    const numbers = (data.objects ?? []).map(n => ({
      number:          n.number,
      countryCode:     countryCode.toUpperCase(),
      region:          n.region ?? null,
      numberType:      (n.type?.toLowerCase() ?? numberType) as "local" | "toll_free" | "mobile",
      monthlyRateCents: Math.round(parseFloat(n.monthly_rental_rate ?? "0") * 100),
    }));

    res.json(ListAvailablePhoneNumbersResponse.parse(numbers));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch available numbers from Vobiz");
    res.json([]);
  }
});

// ── POST /phone-numbers/purchase ──────────────────────────────────────────────

router.post("/phone-numbers/purchase", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = PurchasePhoneNumberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { number, countryCode, region, numberType } = parsed.data;

  // Check balance
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.walletBalanceCents < PHONE_NUMBER_COST_CENTS) {
    res.status(402).json({ error: "Insufficient balance. Top up your wallet to purchase a phone number ($5.00)." });
    return;
  }

  // Check not already owned
  const [existing] = await db.select({ id: phoneNumbersTable.id }).from(phoneNumbersTable).where(eq(phoneNumbersTable.number, number));
  if (existing) { res.status(409).json({ error: "This number is already owned." }); return; }

  const { authId, authToken, configured } = getPlatformVobizCreds();

  let vobizNumberId: string | null = null;

  if (configured) {
    try {
      const resp = await fetch(`${vobizBase(authId!)}/PhoneNumber/${encodeURIComponent(number)}/`, {
        method:  "POST",
        headers: vobizHeaders(authId!, authToken!),
        body:    JSON.stringify({}),
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Vobiz purchase error ${resp.status}: ${err}`);
      }
      const data = await resp.json() as { status?: string; message?: string; number?: string };
      vobizNumberId = data.number ?? number;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "Vobiz number purchase failed");
      res.status(400).json({ error: msg });
      return;
    }
  } else {
    // Platform credentials not configured — store as mock (dev/demo mode)
    vobizNumberId = number;
    req.log.warn({ number }, "VOBIZ_AUTH_ID/TOKEN not set — storing number without Vobiz provisioning");
  }

  // Deduct wallet + create transaction atomically (best-effort — Vobiz already charged)
  const newBalance = user.walletBalanceCents - PHONE_NUMBER_COST_CENTS;
  await db.update(usersTable).set({ walletBalanceCents: newBalance }).where(eq(usersTable.id, user.id));
  await db.insert(walletTransactionsTable).values({
    userId:      user.id,
    type:        "debit",
    amountCents: -PHONE_NUMBER_COST_CENTS,
    description: `Phone number ${number} purchased`,
    status:      "completed",
  });

  const [row] = await db.insert(phoneNumbersTable).values({
    userId:        clerkId,
    number,
    countryCode:   countryCode.toUpperCase(),
    region:        region ?? null,
    numberType:    numberType ?? "local",
    vobizNumberId,
    status:        "active",
  }).returning();

  await logActivity({
    userId:       clerkId,
    eventType:    "phone_number.purchased",
    resourceType: "phone_number",
    resourceId:   String(row.id),
    description:  `Phone number ${number} purchased ($5.00)`,
  });

  req.log.info({ number, userId: clerkId }, "Phone number purchased");
  res.status(201).json(await enrichNumber(row));
});

// ── PATCH /phone-numbers/:id/assign ──────────────────────────────────────────

router.patch("/phone-numbers/:id/assign", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params  = AssignPhoneNumberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = AssignPhoneNumberBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [row] = await db
    .update(phoneNumbersTable)
    .set({ agentId: body.data.agentId ?? null })
    .where(and(eq(phoneNumbersTable.id, params.data.id), eq(phoneNumbersTable.userId, clerkId)))
    .returning();

  if (!row) { res.status(404).json({ error: "Phone number not found" }); return; }

  await logActivity({
    userId:       clerkId,
    eventType:    "phone_number.assigned",
    resourceType: "phone_number",
    resourceId:   String(row.id),
    description:  body.data.agentId
      ? `Phone number ${row.number} assigned to agent #${body.data.agentId}`
      : `Phone number ${row.number} unassigned from agent`,
  });

  res.json(AssignPhoneNumberResponse.parse(await enrichNumber(row)));
});

// ── DELETE /phone-numbers/:id ─────────────────────────────────────────────────

router.delete("/phone-numbers/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params  = ReleasePhoneNumberParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [existing] = await db
    .select()
    .from(phoneNumbersTable)
    .where(and(eq(phoneNumbersTable.id, params.data.id), eq(phoneNumbersTable.userId, clerkId)));

  if (!existing) { res.status(404).json({ error: "Phone number not found" }); return; }

  const { authId, authToken, configured } = getPlatformVobizCreds();

  if (configured && existing.vobizNumberId) {
    try {
      const resp = await fetch(
        `${vobizBase(authId!)}/PhoneNumber/${encodeURIComponent(existing.vobizNumberId)}/`,
        { method: "DELETE", headers: vobizHeaders(authId!, authToken!) }
      );
      if (!resp.ok && resp.status !== 404) {
        req.log.warn({ status: resp.status }, "Vobiz release returned non-ok, continuing with local release");
      }
    } catch (err) {
      req.log.warn({ err }, "Vobiz release failed — continuing with local release");
    }
  }

  await db
    .update(phoneNumbersTable)
    .set({ status: "released", releasedAt: new Date(), agentId: null })
    .where(eq(phoneNumbersTable.id, existing.id));

  await logActivity({
    userId:       clerkId,
    eventType:    "phone_number.released",
    resourceType: "phone_number",
    resourceId:   String(existing.id),
    description:  `Phone number ${existing.number} released`,
  });

  res.sendStatus(204);
});

export default router;
