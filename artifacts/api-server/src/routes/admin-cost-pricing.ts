/**
 * Admin V2 Cost & Pricing — effective-dated provider costs and customer rates.
 * Creating a new rate closes the previous open version (sets effective_to).
 */
import { Router } from "express";
import {
  db,
  providerCostRatesTable,
  customerPricingRatesTable,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { invalidateCostPricingCaches } from "../services/cost-pricing-lookup.js";

const router = Router();
router.use("/admin/pricing", requireAdmin);

function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── Provider costs ────────────────────────────────────────────────────────────

router.get("/admin/pricing/provider-costs", async (req, res): Promise<void> => {
  try {
    const activeOnly = String(req.query.active ?? "true") !== "false";
    const rows = activeOnly
      ? await db
          .select()
          .from(providerCostRatesTable)
          .where(isNull(providerCostRatesTable.effectiveTo))
          .orderBy(desc(providerCostRatesTable.effectiveFrom))
      : await db
          .select()
          .from(providerCostRatesTable)
          .orderBy(desc(providerCostRatesTable.effectiveFrom))
          .limit(500);
    res.json({ rates: rows });
  } catch (err) {
    req.log?.error({ err }, "provider-costs list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/pricing/provider-costs/history", async (req, res): Promise<void> => {
  try {
    const provider = req.query.provider ? String(req.query.provider) : null;
    const service = req.query.service ? String(req.query.service) : null;
    const filters = [];
    if (provider) filters.push(eq(providerCostRatesTable.provider, provider));
    if (service) filters.push(eq(providerCostRatesTable.service, service));
    const rows = await db
      .select()
      .from(providerCostRatesTable)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(providerCostRatesTable.effectiveFrom))
      .limit(500);
    res.json({ history: rows });
  } catch (err) {
    req.log?.error({ err }, "provider-costs history failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/pricing/provider-costs", async (req, res): Promise<void> => {
  try {
    const body = req.body as {
      provider?: string;
      service?: string;
      billingUnit?: string;
      rate?: string | number;
      currency?: string;
      effectiveFrom?: string;
      notes?: string;
    };
    const provider = (body.provider ?? "").trim().toLowerCase();
    const service = (body.service ?? "").trim().toLowerCase();
    const billingUnit = (body.billingUnit ?? "per_minute").trim();
    const rate = String(body.rate ?? "").trim();
    const currency = (body.currency ?? "INR").trim().toUpperCase();
    const effectiveFrom = parseDate(body.effectiveFrom) ?? new Date();
    if (!provider || !service || !rate || Number.isNaN(Number(rate))) {
      res.status(400).json({ error: "provider, service, and numeric rate are required" });
      return;
    }

    // Close any open version for same provider+service+billingUnit
    await db
      .update(providerCostRatesTable)
      .set({
        effectiveTo: new Date(effectiveFrom.getTime() - 1),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(providerCostRatesTable.provider, provider),
          eq(providerCostRatesTable.service, service),
          eq(providerCostRatesTable.billingUnit, billingUnit),
          isNull(providerCostRatesTable.effectiveTo),
        ),
      );

    const [created] = await db
      .insert(providerCostRatesTable)
      .values({
        provider,
        service,
        billingUnit,
        rate,
        currency,
        effectiveFrom,
        effectiveTo: null,
        createdBy: "admin",
        notes: body.notes ?? null,
      })
      .returning();

    invalidateCostPricingCaches();

    res.status(201).json({
      rate: created,
      message:
        "This rate applies only to usage from the effective date onward. Historical financial calculations remain unchanged.",
    });
  } catch (err) {
    req.log?.error({ err }, "provider-costs create failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Customer pricing ──────────────────────────────────────────────────────────

router.get("/admin/pricing/customer-rates", async (req, res): Promise<void> => {
  try {
    const activeOnly = String(req.query.active ?? "true") !== "false";
    const rows = activeOnly
      ? await db
          .select()
          .from(customerPricingRatesTable)
          .where(isNull(customerPricingRatesTable.effectiveTo))
          .orderBy(desc(customerPricingRatesTable.effectiveFrom))
      : await db
          .select()
          .from(customerPricingRatesTable)
          .orderBy(desc(customerPricingRatesTable.effectiveFrom))
          .limit(500);
    res.json({ rates: rows });
  } catch (err) {
    req.log?.error({ err }, "customer-rates list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/pricing/customer-rates/history", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(customerPricingRatesTable)
      .orderBy(desc(customerPricingRatesTable.effectiveFrom))
      .limit(500);
    res.json({ history: rows });
  } catch (err) {
    req.log?.error({ err }, "customer-rates history failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/pricing/customer-rates", async (req, res): Promise<void> => {
  try {
    const body = req.body as {
      plan?: string;
      segment?: string;
      service?: string;
      billingUnit?: string;
      rate?: string | number;
      currency?: string;
      effectiveFrom?: string;
      notes?: string;
    };
    const plan = (body.plan ?? "standard").trim().toLowerCase();
    const segment = (body.segment ?? "default").trim().toLowerCase();
    const service = (body.service ?? "voice").trim().toLowerCase();
    const billingUnit = (body.billingUnit ?? "per_minute").trim();
    const rate = String(body.rate ?? "").trim();
    const currency = (body.currency ?? "INR").trim().toUpperCase();
    const effectiveFrom = parseDate(body.effectiveFrom) ?? new Date();
    if (!rate || Number.isNaN(Number(rate))) {
      res.status(400).json({ error: "numeric rate is required" });
      return;
    }

    await db
      .update(customerPricingRatesTable)
      .set({
        effectiveTo: new Date(effectiveFrom.getTime() - 1),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customerPricingRatesTable.plan, plan),
          eq(customerPricingRatesTable.segment, segment),
          eq(customerPricingRatesTable.service, service),
          eq(customerPricingRatesTable.billingUnit, billingUnit),
          isNull(customerPricingRatesTable.effectiveTo),
        ),
      );

    const [created] = await db
      .insert(customerPricingRatesTable)
      .values({
        plan,
        segment,
        service,
        billingUnit,
        rate,
        currency,
        effectiveFrom,
        effectiveTo: null,
        createdBy: "admin",
        notes: body.notes ?? null,
      })
      .returning();

    invalidateCostPricingCaches();

    res.status(201).json({
      rate: created,
      message:
        "This rate applies only to usage from the effective date onward. Historical financial calculations remain unchanged.",
    });
  } catch (err) {
    req.log?.error({ err }, "customer-rates create failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Profit simulator (no DB write) ────────────────────────────────────────────

router.post("/admin/pricing/simulator", async (req, res): Promise<void> => {
  try {
    const body = req.body as {
      customerPricePerMin?: number;
      telephonyCostPerMin?: number;
      sttCostPerMin?: number;
      ttsCostPerMin?: number;
      llmCostPerMin?: number;
      otherCostPerMin?: number;
      averageMinutes?: number;
      numberOfUsers?: number;
    };
    const customer = Number(body.customerPricePerMin ?? 0);
    const telephony = Number(body.telephonyCostPerMin ?? 0);
    const stt = Number(body.sttCostPerMin ?? 0);
    const tts = Number(body.ttsCostPerMin ?? 0);
    const llm = Number(body.llmCostPerMin ?? 0);
    const other = Number(body.otherCostPerMin ?? 0);
    const avgMin = Number(body.averageMinutes ?? 0);
    const users = Number(body.numberOfUsers ?? 0);

    const costPerMin = telephony + stt + tts + llm + other;
    const profitPerMin = customer - costPerMin;
    const marginPct = customer > 0 ? (profitPerMin / customer) * 100 : 0;
    const totalMinutes = avgMin * users;
    const revenue = customer * totalMinutes;
    const cost = costPerMin * totalMinutes;
    const grossProfit = revenue - cost;

    res.json({
      inputs: { customer, telephony, stt, tts, llm, other, avgMin, users },
      outputs: {
        costPerMin,
        profitPerMin,
        marginPct: Math.round(marginPct * 100) / 100,
        totalMinutes,
        revenue,
        cost,
        grossProfit,
        projectedMonthlyProfit: grossProfit,
      },
    });
  } catch (err) {
    req.log?.error({ err }, "pricing simulator failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Overview strip for cost-pricing hub
router.get("/admin/pricing/overview", async (_req, res): Promise<void> => {
  try {
    const [[providerActive], [customerActive], [providerVersions], [customerVersions]] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(providerCostRatesTable).where(isNull(providerCostRatesTable.effectiveTo)),
      db.select({ c: sql<number>`count(*)` }).from(customerPricingRatesTable).where(isNull(customerPricingRatesTable.effectiveTo)),
      db.select({ c: sql<number>`count(*)` }).from(providerCostRatesTable),
      db.select({ c: sql<number>`count(*)` }).from(customerPricingRatesTable),
    ]);
    res.json({
      activeProviderCosts: Number(providerActive?.c ?? 0),
      activeCustomerRates: Number(customerActive?.c ?? 0),
      providerCostVersions: Number(providerVersions?.c ?? 0),
      customerRateVersions: Number(customerVersions?.c ?? 0),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
