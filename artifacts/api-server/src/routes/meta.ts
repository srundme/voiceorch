/**
 * Meta Lead Ads integration
 * Receives Facebook leadgen webhooks, stores leads, and auto-fires outbound calls.
 */
import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  db,
  metaIntegrationsTable,
  metaLeadsTable,
  agentsTable,
  phoneNumbersTable,
  providersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { encryptKey } from "../lib/crypto.js";
import { decryptKey } from "../lib/crypto.js";
import { dialTwilio, dialPlivo, dialVobiz } from "../orchestration/telephony/dial.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function resolveBaseUrl(): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) return `https://${domains.split(",")[0]!.trim()}`;
  return `http://localhost:${process.env["PORT"] ?? "8080"}`;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

function parseLeadFieldData(
  fieldData: Array<{ name: string; values: string[] }>,
): { phone: string | null; name: string | null; email: string | null; extra: Record<string, string> } {
  const map: Record<string, string> = {};
  for (const f of fieldData) {
    map[f.name.toLowerCase()] = f.values[0] ?? "";
  }
  return {
    phone: map["phone_number"] ?? map["phone"] ?? null,
    name:  map["full_name"] ?? map["name"] ?? null,
    email: map["email"] ?? null,
    extra: map,
  };
}

async function fireMetaLeadCall(opts: {
  userId: string;
  agentId: number;
  phoneNumberId: number;
  toNumber: string;
  leadData: Record<string, string>;
  metaLeadId: number;
}): Promise<void> {
  const baseUrl = resolveBaseUrl();

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, opts.agentId));
  if (!agent) throw new Error(`Agent ${opts.agentId} not found`);

  const [phone] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, opts.phoneNumberId));
  if (!phone) throw new Error(`Phone number ${opts.phoneNumberId} not found`);

  const provider = agent.telephonyProvider.toLowerCase();
  const [provRow] = await db
    .select()
    .from(providersTable)
    .where(and(eq(providersTable.providerName, provider), eq(providersTable.isActive, true)))
    .limit(1);
  if (!provRow) throw new Error(`No active "${provider}" provider configured`);

  const cfg = provRow.extraConfig ? (JSON.parse(provRow.extraConfig) as Record<string, string>) : {};

  // Encode lead data into webhook URL so session handler can inject {{variables}}
  const leadParam = encodeURIComponent(JSON.stringify(opts.leadData));

  if (provider === "twilio") {
    if (!cfg["accountSid"] || !cfg["fromNumber"]) throw new Error("Twilio config missing accountSid or fromNumber");
    await dialTwilio({
      accountSid:        cfg["accountSid"]!,
      authToken:         decryptKey(provRow.apiKey),
      fromNumber:        phone.number ?? cfg["fromNumber"]!,
      toNumber:          opts.toNumber,
      webhookUrl:        `${baseUrl}/api/webhooks/twilio/voice?agentId=${opts.agentId}&metaLeadId=${opts.metaLeadId}`,
      statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status`,
    });
  } else if (provider === "plivo") {
    if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Plivo config missing authId or fromNumber");
    await dialPlivo({
      authId:    cfg["authId"]!,
      authToken: decryptKey(provRow.apiKey),
      fromNumber:phone.number ?? cfg["fromNumber"]!,
      toNumber:  opts.toNumber,
      answerUrl: `${baseUrl}/api/webhooks/plivo/voice?agentId=${opts.agentId}&metaLeadId=${opts.metaLeadId}`,
    });
  } else if (provider === "vobiz") {
    if (!cfg["authId"] || !cfg["fromNumber"]) throw new Error("Vobiz config missing authId or fromNumber");
    await dialVobiz({
      authId:    cfg["authId"]!,
      authToken: decryptKey(provRow.apiKey),
      fromNumber:phone.number ?? cfg["fromNumber"]!,
      toNumber:  opts.toNumber,
      answerUrl: `${baseUrl}/api/webhooks/vobiz/voice?agentId=${opts.agentId}&metaLeadId=${opts.metaLeadId}`,
      hangupUrl: `${baseUrl}/api/webhooks/vobiz/status`,
    });
  } else {
    throw new Error(`Outbound calls not supported for provider: ${provider}`);
  }

  logger.info({ metaLeadId: opts.metaLeadId, toNumber: opts.toNumber }, "Meta lead call fired");
}

/* ── GET /meta/integrations ─────────────────────────────────────────────── */

router.get("/meta/integrations", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;

  const rows = await db
    .select({
      id:            metaIntegrationsTable.id,
      pageName:      metaIntegrationsTable.pageName,
      formId:        metaIntegrationsTable.formId,
      formName:      metaIntegrationsTable.formName,
      agentId:       metaIntegrationsTable.agentId,
      phoneNumberId: metaIntegrationsTable.phoneNumberId,
      webhookToken:  metaIntegrationsTable.webhookToken,
      active:        metaIntegrationsTable.active,
      createdAt:     metaIntegrationsTable.createdAt,
      agentName:     agentsTable.name,
    })
    .from(metaIntegrationsTable)
    .leftJoin(agentsTable, eq(metaIntegrationsTable.agentId, agentsTable.id))
    .where(eq(metaIntegrationsTable.userId, userId))
    .orderBy(desc(metaIntegrationsTable.createdAt));

  res.json({ integrations: rows });
});

/* ── POST /meta/integrations ────────────────────────────────────────────── */

router.post("/meta/integrations", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const {
    pageName, formId, formName, agentId, phoneNumberId, accessToken,
  } = req.body as {
    pageName?: string; formId: string; formName?: string;
    agentId?: number; phoneNumberId?: number; accessToken: string;
  };

  if (!formId || !accessToken) {
    res.status(400).json({ error: "formId and accessToken are required" });
    return;
  }

  const webhookToken = randomBytes(20).toString("hex");

  const [row] = await db.insert(metaIntegrationsTable).values({
    userId,
    pageName:             pageName ?? null,
    formId,
    formName:             formName ?? null,
    agentId:              agentId ?? null,
    phoneNumberId:        phoneNumberId ?? null,
    accessTokenEncrypted: encryptKey(accessToken),
    webhookToken,
  }).returning();

  const base = resolveBaseUrl();
  req.log.info({ userId, formId }, "Meta integration created");
  res.status(201).json({
    id:           row!.id,
    webhookToken: row!.webhookToken,
    webhookUrl:   `${base}/api/meta/webhook/${webhookToken}`,
    verifyToken:  webhookToken,
  });
});

/* ── PATCH /meta/integrations/:id ───────────────────────────────────────── */

router.patch("/meta/integrations/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id     = Number(req.params["id"]);
  const { agentId, phoneNumberId, active } = req.body as {
    agentId?: number | null; phoneNumberId?: number | null; active?: boolean;
  };

  const updates: Partial<typeof metaIntegrationsTable.$inferInsert> = {};
  if (agentId       !== undefined) updates.agentId       = agentId;
  if (phoneNumberId !== undefined) updates.phoneNumberId = phoneNumberId;
  if (active        !== undefined) updates.active        = active;

  await db.update(metaIntegrationsTable).set(updates)
    .where(and(eq(metaIntegrationsTable.id, id), eq(metaIntegrationsTable.userId, userId)));

  res.json({ ok: true });
});

/* ── DELETE /meta/integrations/:id ──────────────────────────────────────── */

router.delete("/meta/integrations/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id     = Number(req.params["id"]);

  await db.delete(metaIntegrationsTable)
    .where(and(eq(metaIntegrationsTable.id, id), eq(metaIntegrationsTable.userId, userId)));

  res.json({ ok: true });
});

/* ── GET /meta/leads ────────────────────────────────────────────────────── */

router.get("/meta/leads", requireAuth, async (req, res): Promise<void> => {
  const userId        = (req as any).clerkUserId as string;
  const integrationId = req.query["integrationId"] ? Number(req.query["integrationId"]) : undefined;

  const rows = await db
    .select()
    .from(metaLeadsTable)
    .where(
      integrationId
        ? and(eq(metaLeadsTable.userId, userId), eq(metaLeadsTable.integrationId, integrationId))
        : eq(metaLeadsTable.userId, userId),
    )
    .orderBy(desc(metaLeadsTable.createdAt))
    .limit(200);

  res.json({ leads: rows });
});

/* ── GET /meta/webhook/:token  (Facebook hub verification) ──────────────── */

router.get("/meta/webhook/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const mode      = req.query["hub.mode"]         as string | undefined;
  const challenge = req.query["hub.challenge"]    as string | undefined;
  const verify    = req.query["hub.verify_token"] as string | undefined;

  if (mode === "subscribe" && verify === token) {
    const [row] = await db
      .select({ id: metaIntegrationsTable.id })
      .from(metaIntegrationsTable)
      .where(eq(metaIntegrationsTable.webhookToken, token));

    if (row) { res.send(challenge); return; }
  }
  res.sendStatus(403);
});

/* ── POST /meta/webhook/:token  (Lead event from Meta) ──────────────────── */

router.post("/meta/webhook/:token", async (req, res): Promise<void> => {
  res.sendStatus(200); // always ack fast

  const { token } = req.params as { token: string };
  const body = req.body as {
    object?: string;
    entry?: Array<{
      changes?: Array<{
        field?: string;
        value?: {
          form_id?: string;
          leadgen_id?: string;
          field_data?: Array<{ name: string; values: string[] }>;
        };
      }>;
    }>;
  };

  if (body.object !== "page") return;

  try {
    const [integration] = await db
      .select()
      .from(metaIntegrationsTable)
      .where(and(eq(metaIntegrationsTable.webhookToken, token), eq(metaIntegrationsTable.active, true)));

    if (!integration) { logger.warn({ token }, "Meta webhook for unknown/inactive integration"); return; }

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "leadgen") continue;
        const val = change.value;
        if (!val?.leadgen_id) continue;

        const { phone, name, email, extra } = parseLeadFieldData(val.field_data ?? []);

        // Idempotency guard
        const [existing] = await db
          .select({ id: metaLeadsTable.id })
          .from(metaLeadsTable)
          .where(eq(metaLeadsTable.leadgenId, val.leadgen_id));
        if (existing) continue;

        const [lead] = await db.insert(metaLeadsTable).values({
          integrationId: integration.id,
          userId:        integration.userId,
          leadgenId:     val.leadgen_id,
          leadData:      extra,
          phone:         phone ? normalizePhone(phone) : null,
          name,
          email,
          callStatus:    "pending",
        }).returning();

        logger.info({ leadId: lead!.id, formId: integration.formId }, "Meta lead received");

        if (integration.agentId && integration.phoneNumberId && phone) {
          try {
            await fireMetaLeadCall({
              userId:        integration.userId,
              agentId:       integration.agentId,
              phoneNumberId: integration.phoneNumberId,
              toNumber:      normalizePhone(phone),
              leadData:      { ...extra, name: name ?? "", email: email ?? "", phone: normalizePhone(phone) },
              metaLeadId:    lead!.id,
            });
            await db.update(metaLeadsTable)
              .set({ callStatus: "calling", callAttempts: 1, lastAttemptAt: new Date() })
              .where(eq(metaLeadsTable.id, lead!.id));
          } catch (err) {
            logger.error({ err, leadId: lead!.id }, "Failed to fire call for Meta lead");
            await db.update(metaLeadsTable)
              .set({ callStatus: "failed" })
              .where(eq(metaLeadsTable.id, lead!.id));
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err, token }, "Error processing Meta webhook");
  }
});

export default router;
