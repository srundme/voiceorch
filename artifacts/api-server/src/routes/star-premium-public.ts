/**
 * Unauthenticated Star Health premium lookup, called by voice agents as a
 * webhook tool. Serves only the public premium chart. Always answers 200 with a
 * `say` line: a non-OK status reaches the LLM as a bare "webhook_error".
 */
import { Router, type Request } from "express";
import { STAR_PREMIUMS } from "../data/star-premiums.js";
import { answerStarPremium, parseStarPlan, resolveStarZone } from "../services/star-premium.js";

const router: Router = Router();

function args(req: Request): Record<string, unknown> {
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const nested = body["args"] && typeof body["args"] === "object" ? body["args"] as Record<string, unknown> : {};
  return { ...req.query, ...body, ...nested };
}

export function parseAges(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[^0-9.]+/);
  return list
    .filter((v) => String(v).trim() !== "")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 120)
    .map(Math.floor);
}

/** Children of unknown age are priced in the youngest child band. */
const DEFAULT_CHILD_AGE = 10;

/**
 * Pad ages up to the stated head count. A missing adult age takes the eldest
 * known age, which can only raise the Star premium and understate a saving.
 */
export function fillAges(ages: number[], count: unknown, fallback: number | null): number[] {
  const n = Math.min(Math.floor(Number(count)) || 0, 10);
  if (n <= ages.length || fallback == null) return ages;
  return [...ages, ...Array<number>(n - ages.length).fill(fallback)];
}

/** "5", "5 lakh", "7.5L", "1 crore", "500000" → lakh. */
export function parseSumInsuredLakh(raw: unknown): number {
  const s = String(raw ?? "").toLowerCase().replace(/,/g, "");
  const n = Number(s.match(/\d+(\.\d+)?/)?.[0] ?? NaN);
  if (!Number.isFinite(n)) return NaN;
  if (/cr/.test(s)) return n * 100;
  return n >= 1000 ? n / 100_000 : n;
}

/** "18000", "18,000", "18k", "1.2 lakh" → rupees. */
export function parseRupees(raw: unknown): number | null {
  const s = String(raw ?? "").toLowerCase().replace(/,/g, "");
  const n = Number(s.match(/\d+(\.\d+)?/)?.[0] ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (/lakh|lac/.test(s)) return Math.round(n * 100_000);
  if (/\dk\b|thousand/.test(s)) return Math.round(n * 1000);
  return Math.round(n);
}

router.all("/public/tools/star-premium", (req, res): void => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const a = args(req);
  const plan = parseStarPlan(a["plan"]);
  if (!plan) {
    res.json({ ok: false, say: "Unknown plan. Use super_star, comprehensive, or health_assure." });
    return;
  }
  const zone = resolveStarZone(plan, a["city"], a["state"]);
  const adultAges = parseAges(a["adult_ages"]);
  res.json(answerStarPremium(
    STAR_PREMIUMS,
    {
      plan,
      zone,
      adultAges: fillAges(adultAges, a["adult_count"], adultAges.length ? Math.max(...adultAges) : null),
      childAges: fillAges(parseAges(a["child_ages"]), a["child_count"], DEFAULT_CHILD_AGE),
      sumInsuredLakh: parseSumInsuredLakh(a["sum_insured_lakh"]),
    },
    parseRupees(a["current_premium"]),
  ));
});

export default router;
