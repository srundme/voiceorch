import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db, landingPartnerLeadsTable } from "@workspace/db";
import { landingLeadsSubmitRateLimit } from "../lib/rate-limit.js";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail } from "../services/brevo.js";
import { extractLeadsApiKey, leadsApiKeyMatches, parseLeadsNotifyEmails } from "./landing-leads-auth.js";

/**
 * Public landing-page partner form.
 * POST /api/leads  (alias: /api/landing/leads)
 *
 * Landing env:
 *   VITE_LEADS_API_URL=https://app.snapserve.ai/api/leads
 *   VITE_LEADS_API_KEY=<same as server LEADS_API_KEY>
 *
 * Server env:
 *   LEADS_API_KEY          routing token (required in production)
 *   LEADS_NOTIFY_EMAILS    comma-separated notify list (two+ addresses)
 */

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().trim().max(200).optional().or(z.literal("")),
  website: z.string().trim().max(400).optional().or(z.literal("")),
  role: z.string().trim().max(120).optional().or(z.literal("")),
  message: z.string().trim().max(5000).optional().or(z.literal("")),
  source: z.string().trim().max(80).optional().or(z.literal("")),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const router = Router();

async function handleCreate(req: Request, res: Response): Promise<void> {
  const expected = (process.env["LEADS_API_KEY"] ?? "").trim();
  if (expected) {
    if (!leadsApiKeyMatches(extractLeadsApiKey({ headers: req.headers as Record<string, unknown> }), expected)) {
      res.status(401).json({ error: "Invalid leads API key" });
      return;
    }
  } else if (process.env["NODE_ENV"] === "production") {
    logger.error("LEADS_API_KEY is not set — refusing public landing submissions");
    res.status(503).json({ error: "Leads intake is not configured" });
    return;
  }

  const parsed = Body.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid form", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

  const [row] = await db
    .insert(landingPartnerLeadsTable)
    .values({
      name: body.name,
      email: body.email,
      phone: blank(body.phone),
      company: blank(body.company),
      website: blank(body.website),
      role: blank(body.role),
      message: blank(body.message),
      source: blank(body.source) ?? "landing",
    })
    .returning({ id: landingPartnerLeadsTable.id });

  const notify = parseLeadsNotifyEmails(process.env["LEADS_NOTIFY_EMAILS"]);
  const subject = `Partner inquiry: ${body.name}${body.company ? ` (${body.company})` : ""}`;
  const html = `
    <p>New <strong>Partner with us</strong> form on the SnapServe landing page.</p>
    <table cellpadding="6" style="border-collapse:collapse">
      <tr><td>Name</td><td>${escapeHtml(body.name)}</td></tr>
      <tr><td>Email</td><td>${escapeHtml(body.email)}</td></tr>
      <tr><td>Phone</td><td>${escapeHtml(blank(body.phone) ?? "—")}</td></tr>
      <tr><td>Company</td><td>${escapeHtml(blank(body.company) ?? "—")}</td></tr>
      <tr><td>Website</td><td>${escapeHtml(blank(body.website) ?? "—")}</td></tr>
      <tr><td>Role</td><td>${escapeHtml(blank(body.role) ?? "—")}</td></tr>
      <tr><td>Message</td><td>${escapeHtml(blank(body.message) ?? "—")}</td></tr>
    </table>
    <p>Also listed in Admin → Partner inquiries.</p>
  `;

  if (notify.length === 0) {
    logger.warn({ leadId: row?.id }, "Landing partner lead saved but LEADS_NOTIFY_EMAILS is empty");
  } else {
    await Promise.allSettled(
      notify.map((to) =>
        sendBrevoEmail(to, subject, html, undefined, {
          emailType: "landing_partner_lead",
          sentBy: "system",
          toName: null,
        }).catch((err) => {
          logger.warn({ err, to, leadId: row?.id }, "Landing partner lead notify email failed");
        }),
      ),
    );
  }

  logger.info({ leadId: row?.id, email: body.email }, "Landing partner lead accepted");
  res.status(201).json({ ok: true, id: row?.id });
}

router.options("/leads", (_req, res) => { res.sendStatus(204); });
router.options("/landing/leads", (_req, res) => { res.sendStatus(204); });
router.post("/leads", landingLeadsSubmitRateLimit, handleCreate);
router.post("/landing/leads", landingLeadsSubmitRateLimit, handleCreate);

export default router;
