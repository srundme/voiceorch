import { Router, type IRouter } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db, knowledgeSourcesTable, knowledgeEntriesTable, agentsTable, agentKnowledgeSourcesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { logger } from "../lib/logger.js";
import { ingestKbTextEntries, type KbEntryInput } from "../services/kb-ingest.js";
import { getKbEmbedBlock, isKbVectorReady, kickKbEmbedWorker } from "../services/kb-embeddings.js";
import { kickKrutrimSummaryWorker } from "../services/kb-source-summary.js";
import { extractPdfChunksWithGemini } from "../services/kb-pdf-extract.js";
import {
  buildKnowledgeSearchPayload,
  isPureNonLatinQuery,
  retrieveKbContextMultiEx,
} from "../orchestration/kb-retrieval.js";
import multer from "multer";
import mammoth from "mammoth";
import { createRequire } from "node:module";
import { lookup as dnsLookup } from "node:dns/promises";
const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

/**
 * Explicit column set for every knowledge_entries SELECT/RETURNING in this
 * router. NEVER select * / full-row returning on this table:
 * (a) the fat `embedding` vector must not be shipped to API clients, and
 * (b) on databases where the pgvector migration soft-failed the embedding
 *     column doesn't exist, so referencing it would break every KB route.
 */
const entryCols = {
  id: knowledgeEntriesTable.id,
  sourceId: knowledgeEntriesTable.sourceId,
  userId: knowledgeEntriesTable.userId,
  title: knowledgeEntriesTable.title,
  content: knowledgeEntriesTable.content,
  keywords: knowledgeEntriesTable.keywords,
  createdAt: knowledgeEntriesTable.createdAt,
};
type KbEntryRow = {
  id: number;
  sourceId: number;
  userId: string;
  title: string | null;
  content: string;
  keywords: string | null;
  createdAt: Date;
};

/** Split extracted document text into reasonably-sized entry chunks. */
function chunkText(text: string, maxChars = 4000): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  // Prefer splitting on blank lines (paragraphs); merge small paras up to maxChars.
  const paras = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    const para = p.trim();
    if (!para) continue;
    if (para.length > maxChars) {
      // Flush current buffer, then hard-split the oversized paragraph.
      if (buf) { chunks.push(buf); buf = ""; }
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars));
      }
      continue;
    }
    if (buf.length + para.length + 2 > maxChars) {
      chunks.push(buf);
      buf = para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/** Extract plain text from an uploaded document buffer based on its filename/mimetype. */
async function extractDocumentText(file: Express.Multer.File): Promise<string> {
  const name = (file.originalname || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

  if (ext === "pdf" || file.mimetype === "application/pdf") {
    // pdf-parse is CommonJS; load via createRequire to avoid ESM interop issues.
    const require = createRequire(import.meta.url);
    const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
    const result = await pdfParse(file.buffer);
    return result.text ?? "";
  }

  if (ext === "docx" || file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value ?? "";
  }

  // txt / csv / md / markdown and any other plain-text format
  return file.buffer.toString("utf-8");
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function parseFailedUrls(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string" && !!u.trim()) : [];
  } catch {
    return [];
  }
}

/** Enrich list/detail rows with embed progress + attach counts for the dashboard. */
async function enrichKnowledgeSources<T extends { id: number; status: string; entryCount: number; crawlFailedUrls?: string | null; type: string }>(
  sources: T[],
): Promise<Array<T & {
  embeddedCount: number;
  indexing: boolean;
  indexingBlocked: boolean;
  indexingError: string | null;
  needsAttention: boolean;
  failedPageCount: number;
  attachedAgentCount: number;
}>> {
  if (!sources.length) return [];
  const ids = sources.map((s) => s.id);
  const vectorReady = isKbVectorReady();
  const embedBlock = getKbEmbedBlock();

  const embedCounts = new Map<number, number>();
  if (vectorReady) {
    try {
      const rows = await db.execute<{ sourceId: number; embedded: string }>(sql`
        SELECT source_id AS "sourceId",
          count(*) FILTER (WHERE embedding IS NOT NULL)::text AS embedded
        FROM knowledge_entries
        WHERE source_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        GROUP BY source_id
      `);
      for (const r of rows.rows) {
        embedCounts.set(Number(r.sourceId), Number(r.embedded) || 0);
      }
    } catch {
      /* embedding column missing — treat as fully indexed for UI */
    }
  }

  const attachRows = await db
    .select({
      sourceId: agentKnowledgeSourcesTable.sourceId,
      n: sql<number>`count(*)::int`,
    })
    .from(agentKnowledgeSourcesTable)
    .where(inArray(agentKnowledgeSourcesTable.sourceId, ids))
    .groupBy(agentKnowledgeSourcesTable.sourceId);
  const attachCounts = new Map(attachRows.map((r) => [r.sourceId, Number(r.n) || 0]));

  const terminalOk = new Set(["ready", "partial", "active"]);
  return sources.map((s) => {
    const failed = parseFailedUrls(s.crawlFailedUrls);
    const embeddedCount = vectorReady ? (embedCounts.get(s.id) ?? 0) : s.entryCount;
    const pending =
      terminalOk.has(s.status)
      && s.entryCount > 0
      && vectorReady
      && embeddedCount < s.entryCount;
    // With the embed breaker open the remaining entries will never finish;
    // the source is usable via keyword search, so say that instead of spinning.
    const indexingBlocked = pending && !!embedBlock;
    return {
      ...s,
      embeddedCount,
      indexing: pending && !indexingBlocked,
      indexingBlocked,
      indexingError: indexingBlocked ? embedBlock!.reason : null,
      needsAttention: s.status === "partial" || failed.length > 0,
      failedPageCount: failed.length,
      attachedAgentCount: attachCounts.get(s.id) ?? 0,
    };
  });
}

/** Strip HTML tags, boilerplate sections, and collapse whitespace */
function stripHtml(html: string): string {
  return html
    // Remove non-content sections entirely before stripping tags
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract page title from HTML */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1]!.trim() : "Imported Page";
}

/** Extract meta description / og:description from HTML */
function extractMetaDescription(html: string): string {
  const patterns = [
    /<meta\s[^>]*name=["']description["'][^>]*content=["']([^"']{10,})["']/i,
    /<meta\s[^>]*content=["']([^"']{10,})["'][^>]*name=["']description["']/i,
    /<meta\s[^>]*property=["']og:description["'][^>]*content=["']([^"']{10,})["']/i,
    /<meta\s[^>]*content=["']([^"']{10,})["'][^>]*property=["']og:description["']/i,
    /<meta\s[^>]*name=["']twitter:description["'][^>]*content=["']([^"']{10,})["']/i,
    /<meta\s[^>]*content=["']([^"']{10,})["'][^>]*name=["']twitter:description["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

/** Private/loopback IP pattern check */
function isPrivateIp(ip: string): boolean {
  // IPv6 loopback and ULA/link-local
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80") || ip.toLowerCase() === "0:0:0:0:0:0:0:1") return true;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 127 ||                         // loopback
    a === 10 ||                          // RFC 1918 class A
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918 class B
    (a === 192 && b === 168) ||          // RFC 1918 class C
    (a === 169 && b === 254) ||          // APIPA / link-local
    a === 0                              // 0.0.0.0/8
  );
}

/**
 * Resolve the URL's hostname via DNS and verify no resolved address is private.
 * Throws if any resolved address is blocked or if DNS fails.
 */
async function assertNotSsrf(rawUrl: string): Promise<void> {
  const u = new URL(rawUrl); // already validated before call
  let addresses: { address: string }[];
  try {
    addresses = await dnsLookup(u.hostname, { all: true });
  } catch (dnsErr) {
    throw new Error(`DNS resolution failed for ${u.hostname}: ${(dnsErr as Error).message}`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`Blocked: ${u.hostname} resolves to private/internal address ${address}`);
    }
  }
}

const SAFE_FETCH_MAX_REDIRECTS = 5;

/**
 * Fetch `url` with SSRF validation at each redirect hop.
 * Unlike `redirect: "follow"`, this validates the destination hostname/IP
 * at every redirect so an attacker-controlled domain cannot chain through
 * a public CNAME to a private IP via HTTP redirect.
 */
async function safeFetch(
  url: string,
  options: RequestInit,
  hopsLeft = SAFE_FETCH_MAX_REDIRECTS,
  /**
   * When set, rejects any redirect that changes hostname (crawler same-hostname guard).
   * Using hostname (not origin) allows http:// → https:// upgrades on the same host,
   * while still blocking open-redirect chains to completely different domains.
   */
  allowedHostname?: string,
): Promise<Response> {
  // Validate this hop before fetching (SSRF: hostname + DNS resolution)
  await assertNotSsrf(url);
  const res = await fetch(url, { ...options, redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location || hopsLeft <= 0) {
      throw new Error(`Redirect limit exceeded or missing Location for ${url}`);
    }
    // Resolve relative redirects against the current URL
    const next = new URL(location, url).href;
    // Enforce same-hostname if caller requested it (allows http→https, blocks cross-domain)
    if (allowedHostname && new URL(next).hostname !== allowedHostname) {
      throw new Error(`Redirect to different hostname blocked: ${new URL(next).hostname} (allowed: ${allowedHostname})`);
    }
    return safeFetch(next, options, hopsLeft - 1, allowedHostname);
  }
  return res;
}

/** Crawl a URL and return { title, content } */
async function crawlUrl(url: string): Promise<{ title: string; content: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; VoiceOrch-KB-Crawler/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();

  const title = extractTitle(html);
  const meta = extractMetaDescription(html);
  const body = stripHtml(html);

  const unique: string[] = [title];
  if (meta && meta !== title) unique.push(meta);
  const bodyClean = body.length > title.length + 20 ? body : "";
  if (bodyClean) unique.push(bodyClean.slice(0, 15_000));

  return { title, content: unique.join("\n\n").slice(0, 20_000) };
}

/** Extract same-origin links from HTML for multi-page crawling. */
function extractSameOriginLinks(html: string, base: URL): string[] {
  const seen = new Set<string>([base.href]);
  const links: string[] = [];
  const re = /href=["']([^"'> \t\r\n]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]!;
    if (raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    try {
      const u = new URL(raw, base.href);
      if (u.origin !== base.origin) continue;
      u.hash = "";
      u.search = "";
      const key = u.href;
      if (!seen.has(key)) { seen.add(key); links.push(key); }
    } catch { /* invalid URL — skip */ }
  }
  return links;
}

/** Increment/decrement entry_count on a knowledge source */
async function syncEntryCount(sourceId: number) {
  await db.execute(sql`
    UPDATE knowledge_sources
    SET entry_count = (SELECT COUNT(*) FROM knowledge_entries WHERE source_id = ${sourceId}),
        updated_at  = NOW()
    WHERE id = ${sourceId}
  `);
}

/* ── List ────────────────────────────────────────────────────────────────── */

router.get("/knowledge-sources", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const sources = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(eq(knowledgeSourcesTable.userId, userId))
    .orderBy(sql`created_at DESC`);
  res.json(await enrichKnowledgeSources(sources));
});

/* ── Create ──────────────────────────────────────────────────────────────── */

router.post("/knowledge-sources", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { name, type, url, entries = [] } = req.body as {
    name: string;
    type: "faq" | "text" | "website" | "file";
    url?: string;
    entries?: Array<{ title?: string; content: string; keywords?: string }>;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!["faq", "text", "website", "file"].includes(type)) {
    res.status(400).json({ error: "type must be faq, text, website, or file" });
    return;
  }

  // Website sources start as "validating" (SSRF + URL parse checks) then transition
  // to "processing" → "crawling" → "ready|partial|failed".
  // All other source types start as "processing" and go directly to "ready|failed".
  const status = type === "website" ? "validating" : "processing";
  const [source] = await db
    .insert(knowledgeSourcesTable)
    .values({ userId, name: name.trim(), type, status })
    .returning();

  const createdEntries: KbEntryRow[] = [];

  if (type === "website") {
    if (!url?.trim()) {
      await db.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, source!.id));
      res.status(400).json({ error: "url is required for type=website" });
      return;
    }
    const sourceId = source!.id;
    const seedUrl  = url.trim();
    const MAX_PAGES = Math.min(Number(process.env["KB_CRAWL_MAX_PAGES"] ?? "20"), 50);
    const CRAWLER_UA = "Mozilla/5.0 (compatible; VoiceOrch-KB-Crawler/1.0)";

    (async () => {
      // ── 1. Validate URL (parse + SSRF denylist) ───────────────────────────
      /** Blocks non-http(s) schemes, loopback, RFC-1918 private ranges, APIPA. */
      function isBlockedUrl(raw: string): boolean {
        let u: URL; try { u = new URL(raw); } catch { return true; }
        if (!["http:", "https:"].includes(u.protocol)) return true;
        const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".localhost")) return true;
        if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
        const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (m) {
          const [a, b] = [Number(m[1]), Number(m[2])];
          if (a === 10 || a === 127 || a === 0 || a >= 224) return true;
          if (a === 172 && b >= 16 && b <= 31) return true;
          if (a === 192 && b === 168) return true;
          if (a === 169 && b === 254) return true;
        }
        return false;
      }

      let baseUrl: URL;
      try { baseUrl = new URL(seedUrl); } catch {
        await db.update(knowledgeSourcesTable)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(knowledgeSourcesTable.id, sourceId));
        logger.warn({ sourceId, url: seedUrl }, "KB crawler: invalid URL");
        return;
      }
      if (isBlockedUrl(seedUrl)) {
        await db.update(knowledgeSourcesTable)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(knowledgeSourcesTable.id, sourceId));
        logger.warn({ sourceId, url: seedUrl }, "KB crawler: URL blocked (private/non-http)");
        return;
      }

      // ── 2. DNS resolution SSRF check (after static-hostname check) ───────
      try {
        await assertNotSsrf(seedUrl);
      } catch (ssrfErr) {
        await db.update(knowledgeSourcesTable)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(knowledgeSourcesTable.id, sourceId));
        logger.warn({ sourceId, url: seedUrl, err: (ssrfErr as Error).message }, "KB crawler: SSRF blocked after DNS resolution");
        return;
      }

      // ── 2b. Advance to processing now that validation passed ──────────────
      await db.update(knowledgeSourcesTable)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(knowledgeSourcesTable.id, sourceId));

      // ── 3. Fetch homepage (SSRF-safe, same-hostname redirects only) ───────
      let homepageHtml = "";
      let homepageText  = "";
      let homepageTitle = "";
      try {
        const r = await safeFetch(seedUrl, {
          headers: { "User-Agent": CRAWLER_UA },
          signal: AbortSignal.timeout(15_000),
        }, SAFE_FETCH_MAX_REDIRECTS, baseUrl.hostname);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        homepageHtml  = await r.text();
        homepageTitle = extractTitle(homepageHtml) || baseUrl.hostname;
        const meta    = extractMetaDescription(homepageHtml);
        const body    = stripHtml(homepageHtml);
        const parts: string[] = [homepageTitle];
        if (meta && meta !== homepageTitle) parts.push(meta);
        if (body.length > homepageTitle.length + 20) parts.push(body.slice(0, 12_000));
        homepageText  = parts.join("\n\n").slice(0, 15_000);
      } catch (err) {
        logger.warn({ err, sourceId, url: seedUrl }, "KB crawler: homepage fetch failed");
        await db.update(knowledgeSourcesTable)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(knowledgeSourcesTable.id, sourceId));
        return;
      }

      // ── 4. Discover internal links ────────────────────────────────────────
      const internalLinks = extractSameOriginLinks(homepageHtml, baseUrl);
      const pagesToFetch  = internalLinks.slice(0, MAX_PAGES - 1); // homepage takes one slot

      // ── 5. Mark as crawling (multi-page) ─────────────────────────────────
      await db.update(knowledgeSourcesTable)
        .set({ status: "crawling", updatedAt: new Date() })
        .where(eq(knowledgeSourcesTable.id, sourceId));

      let successCount = 0;
      let failCount    = 0;
      const failedUrls: string[] = [];

      // ── 6. Insert homepage entry ──────────────────────────────────────────
      if (homepageText.trim()) {
        await db.insert(knowledgeEntriesTable).values({
          sourceId, userId,
          title:    homepageTitle,
          content:  homepageText,
          keywords: seedUrl,
        }).then(() => { successCount++; }).catch(() => {
          failCount++;
          failedUrls.push(seedUrl);
        });
      } else {
        failCount++;
        failedUrls.push(seedUrl);
      }

      // ── 6. Fetch and index internal pages ─────────────────────────────────
      for (const pageUrl of pagesToFetch) {
        try {
          const r = await safeFetch(pageUrl, {
            headers: { "User-Agent": CRAWLER_UA },
            signal: AbortSignal.timeout(10_000),
          }, SAFE_FETCH_MAX_REDIRECTS, baseUrl.hostname);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const html  = await r.text();
          const title = extractTitle(html) || pageUrl;
          const meta  = extractMetaDescription(html);
          const body  = stripHtml(html);
          const parts: string[] = [title];
          if (meta && meta !== title) parts.push(meta);
          if (body.length > title.length + 20) parts.push(body.slice(0, 12_000));
          const text  = parts.join("\n\n").slice(0, 15_000);
          if (!text.trim()) { failCount++; failedUrls.push(pageUrl); continue; }

          await db.insert(knowledgeEntriesTable).values({
            sourceId, userId, title, content: text, keywords: pageUrl,
          });
          successCount++;
        } catch (err) {
          failCount++;
          failedUrls.push(pageUrl);
          logger.warn({ err, pageUrl, sourceId }, "KB crawler: page fetch failed");
        }
      }

      // ── 7. Set final status ───────────────────────────────────────────────
      const finalStatus = successCount === 0 ? "failed"
        : failCount > 0 ? "partial"
        : "ready";
      await db.update(knowledgeSourcesTable)
        .set({
          status: finalStatus,
          entryCount: successCount,
          crawlFailedUrls: failedUrls.length ? JSON.stringify(failedUrls) : null,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSourcesTable.id, sourceId));
      logger.info({ sourceId, url: seedUrl, successCount, failCount, finalStatus }, "KB website crawl complete");
      kickKbEmbedWorker();
      kickKrutrimSummaryWorker();
    })().catch(err => {
      logger.warn({ err, sourceId }, "KB crawler: unhandled crawl error");
      db.update(knowledgeSourcesTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(knowledgeSourcesTable.id, sourceId))
        .catch(() => {});
    });
  } else {
    // Route text/FAQ through the shared ingestion service (same path as Vibe Builder)
    // The source row was already created above in "processing" state; hand off its id.
    const result = await ingestKbTextEntries({
      userId,
      sourceName: name.trim(),
      type: type as "text" | "faq",
      entries,
      existingSourceId: source!.id,
    });
    // Populate createdEntries for the response (reload from DB to stay consistent)
    const inserted = await db.select(entryCols).from(knowledgeEntriesTable)
      .where(eq(knowledgeEntriesTable.sourceId, source!.id));
    createdEntries.push(...inserted);
    // source row was already created; result.entryCount drives the final status
    void result;
  }

  const [refreshed] = await db.select().from(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, source!.id));
  res.status(201).json({ ...refreshed, entries: createdEntries });
});

/* ── Upload document (file source) ───────────────────────────────────────── */

router.post("/knowledge-sources/upload", requireAuth, clientContext, upload.single("file"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const name = String((req.body?.name ?? "")).trim();
  const file = req.file;

  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (!file) { res.status(400).json({ error: "file is required" }); return; }

  const allowedExts = ["pdf", "docx", "txt", "csv", "md", "markdown"];
  const lower = (file.originalname || "").toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (!allowedExts.includes(ext)) {
    res.status(400).json({ error: `Unsupported file type ".${ext}". Allowed: ${allowedExts.join(", ")}` });
    return;
  }

  // Create the source up-front in "processing" state.
  const [source] = await db
    .insert(knowledgeSourcesTable)
    .values({ userId, name, type: "file", status: "processing" })
    .returning();
  const sourceId = source!.id;

  /** Insert extracted entries + finalize source status. Shared by both paths. */
  async function persistEntries(entries: KbEntryInput[], via: string): Promise<KbEntryRow[]> {
    const created: KbEntryRow[] = [];
    for (const e of entries) {
      const [entry] = await db.insert(knowledgeEntriesTable).values({
        sourceId,
        userId,
        title: e.title?.trim() || null,
        content: e.content.trim(),
        keywords: e.keywords?.trim() || null,
      }).returning(entryCols);
      created.push(entry!);
    }
    await db.update(knowledgeSourcesTable)
      .set({ status: "ready", entryCount: created.length, updatedAt: new Date() })
      .where(eq(knowledgeSourcesTable.id, sourceId));
    logger.info({ sourceId, file: file!.originalname, entryCount: created.length, via }, "KB file upload processed");
    kickKbEmbedWorker();
    kickKrutrimSummaryWorker();
    return created;
  }

  function legacyChunks(text: string): KbEntryInput[] {
    const chunks = chunkText(text);
    const baseTitle = file!.originalname;
    return chunks.map((c, i) => ({
      title: chunks.length > 1 ? `${baseTitle} (part ${i + 1})` : baseTitle,
      content: c,
    }));
  }

  const isPdf = ext === "pdf" || file.mimetype === "application/pdf";
  if (isPdf) {
    // PDFs go through Gemini multimodal understanding (text + tables + image
    // descriptions), which can take tens of seconds — so this path is ASYNC:
    // respond immediately with status "processing"; the dashboard already
    // polls processing sources (website crawl uses the same lifecycle).
    // Any Gemini failure falls back to the legacy pdf-parse extraction.
    res.status(201).json({ ...source, entries: [] });
    void (async () => {
      try {
        let entries = await extractPdfChunksWithGemini(file.buffer, file.originalname);
        let via = "gemini-multimodal";
        if (!entries?.length) {
          via = "pdf-parse-fallback";
          const text = await extractDocumentText(file);
          entries = legacyChunks(text);
        }
        if (!entries.length) {
          await db.update(knowledgeSourcesTable)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(knowledgeSourcesTable.id, sourceId));
          logger.warn({ sourceId, file: file.originalname }, "KB PDF upload: no text extracted by either path");
          return;
        }
        await persistEntries(entries, via);
      } catch (err) {
        logger.warn({ err, sourceId, file: file.originalname }, "KB PDF upload processing failed");
        await db.update(knowledgeSourcesTable)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(knowledgeSourcesTable.id, sourceId))
          .catch(() => {});
      }
    })();
    return;
  }

  // Non-PDF formats: fast local extraction, synchronous response (unchanged).
  try {
    const entries = legacyChunks(await extractDocumentText(file));
    if (!entries.length) {
      await db.update(knowledgeSourcesTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(knowledgeSourcesTable.id, sourceId));
      res.status(400).json({ error: "No text could be extracted from the document" });
      return;
    }
    const createdEntries = await persistEntries(entries, "local-extract");
    const [refreshed] = await db.select().from(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, sourceId));
    res.status(201).json({ ...refreshed, entries: createdEntries });
  } catch (err) {
    await db.update(knowledgeSourcesTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(knowledgeSourcesTable.id, sourceId))
      .catch(() => {});
    req.log.warn({ err, sourceId, file: file.originalname }, "KB file upload extraction failed");
    res.status(400).json({ error: "Failed to extract text from the uploaded document" });
  }
});

/* ── Extract text only (used by Vibe Build chat — no DB write) ─────────── */

router.post("/knowledge-sources/extract-text", requireAuth, clientContext, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "file is required" }); return; }

  const allowedExts = ["pdf", "docx", "txt", "csv", "md", "markdown", "html", "json"];
  const lower = (file.originalname || "").toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (!allowedExts.includes(ext)) {
    res.status(400).json({ error: `Unsupported file type ".${ext}"` });
    return;
  }

  try {
    const text = await extractDocumentText(file);
    res.json({ text });
  } catch (err) {
    req.log.warn({ err, file: file.originalname }, "KB extract-text failed");
    res.status(400).json({ error: "Failed to extract text from the uploaded document" });
  }
});

/* ── Get detail ──────────────────────────────────────────────────────────── */

router.get("/knowledge-sources/:id", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  const [source] = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, id), eq(knowledgeSourcesTable.userId, userId)));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }

  const entries = await db
    .select(entryCols)
    .from(knowledgeEntriesTable)
    .where(eq(knowledgeEntriesTable.sourceId, id))
    .orderBy(sql`created_at ASC`);

  const [enriched] = await enrichKnowledgeSources([source]);
  res.json({ ...enriched, entries });
});

/* ── Update (rename) ─────────────────────────────────────────────────────── */

router.patch("/knowledge-sources/:id", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  const [updated] = await db
    .update(knowledgeSourcesTable)
    .set({ name: name.trim(), updatedAt: new Date() })
    .where(and(eq(knowledgeSourcesTable.id, id), eq(knowledgeSourcesTable.userId, userId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

/* ── Delete source ───────────────────────────────────────────────────────── */

router.delete("/knowledge-sources/:id", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  const [deleted] = await db
    .delete(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, id), eq(knowledgeSourcesTable.userId, userId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

/* ── Add entry ───────────────────────────────────────────────────────────── */

router.post("/knowledge-sources/:id/entries", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const sourceId = Number(req.params["id"]);
  const { title, content, keywords } = req.body as { title?: string; content: string; keywords?: string };

  if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }

  const [source] = await db
    .select({ id: knowledgeSourcesTable.id })
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.userId, userId)));
  if (!source) { res.status(404).json({ error: "Source not found" }); return; }

  const [entry] = await db.insert(knowledgeEntriesTable).values({
    sourceId,
    userId,
    title: title?.trim() || null,
    content: content.trim(),
    keywords: keywords?.trim() || null,
  }).returning(entryCols);

  await syncEntryCount(sourceId);
  kickKbEmbedWorker();
  kickKrutrimSummaryWorker();
  res.status(201).json(entry);
});

/* ── Update entry ────────────────────────────────────────────────────────── */

router.patch("/knowledge-sources/:id/entries/:entryId", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const sourceId = Number(req.params["id"]);
  const entryId = Number(req.params["entryId"]);
  const { title, content, keywords } = req.body as { title?: string; content?: string; keywords?: string };

  if (content !== undefined && !content.trim()) {
    res.status(400).json({ error: "content cannot be empty" });
    return;
  }

  const [entry] = await db
    .update(knowledgeEntriesTable)
    .set({
      ...(title !== undefined ? { title: title.trim() || null } : {}),
      ...(content !== undefined ? { content: content.trim() } : {}),
      ...(keywords !== undefined ? { keywords: keywords.trim() || null } : {}),
      // Content changed → stale vector must be dropped so the embed worker
      // re-embeds. Gated: column may not exist on soft-failed-migration DBs.
      ...(content !== undefined && isKbVectorReady()
        ? { embedding: null, embeddingModel: null, embeddedAt: null }
        : {}),
    })
    .where(and(
      eq(knowledgeEntriesTable.id, entryId),
      eq(knowledgeEntriesTable.sourceId, sourceId),
      eq(knowledgeEntriesTable.userId, userId),
    ))
    .returning(entryCols);

  if (!entry) { res.status(404).json({ error: "Not found" }); return; }
  if (content !== undefined) {
    kickKbEmbedWorker();
    kickKrutrimSummaryWorker();
  }
  res.json(entry);
});

/* ── Delete entry ────────────────────────────────────────────────────────── */

router.delete("/knowledge-sources/:id/entries/:entryId", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const sourceId = Number(req.params["id"]);
  const entryId = Number(req.params["entryId"]);

  const [deleted] = await db
    .delete(knowledgeEntriesTable)
    .where(and(
      eq(knowledgeEntriesTable.id, entryId),
      eq(knowledgeEntriesTable.sourceId, sourceId),
      eq(knowledgeEntriesTable.userId, userId),
    ))
    .returning({ id: knowledgeEntriesTable.id });

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  await syncEntryCount(sourceId);
  kickKrutrimSummaryWorker();
  res.status(204).end();
});

/* ── Attach source to agent (deferred — for sources still crawling at build time) ── */

router.post("/knowledge-sources/:id/attach-agent/:agentId", requireAuth, clientContext, async (req, res) => {
  const userId   = (req as any).clerkUserId as string;
  const sourceId = Number(req.params["id"]);
  const agentId  = Number(req.params["agentId"]);
  if (!Number.isFinite(sourceId) || !Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }

  // Validate source ownership + terminal-success status
  const [source] = await db.select({ id: knowledgeSourcesTable.id, status: knowledgeSourcesTable.status })
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.userId, userId)));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }

  const TERMINAL_SUCCESS = ["active", "ready", "partial"];
  if (!TERMINAL_SUCCESS.includes(source.status ?? "")) {
    res.status(409).json({ error: "Source not yet indexed", status: source.status }); return;
  }

  // Validate agent ownership
  const [agent] = await db.select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  // Idempotent attach
  await db.insert(agentKnowledgeSourcesTable)
    .values({ agentId, sourceId })
    .onConflictDoNothing();

  // Attaching may newly link this source to a Krutrim-provider agent for the
  // first time — kick the sweep so it picks up the source promptly rather
  // than waiting up to 10 minutes for the periodic sweep.
  kickKrutrimSummaryWorker();

  res.json({ attached: true });
});

/* ── Search (test panel) — same hybrid RAG path as live calls ────────────── */

router.post("/knowledge-sources/:id/search", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const sourceId = Number(req.params["id"]);
  const { query } = req.body as { query: string };

  if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }

  const [source] = await db
    .select({ id: knowledgeSourcesTable.id })
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.userId, userId)));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }

  const q = query.trim();
  const skipFts = isPureNonLatinQuery(q);
  const result = await retrieveKbContextMultiEx([sourceId], q, 20, { skipFts });
  res.json(buildKnowledgeSearchPayload(result));
});

/* ── Retry failed website pages ──────────────────────────────────────────── */

router.post("/knowledge-sources/:id/retry-crawl", requireAuth, clientContext, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const sourceId = Number(req.params["id"]);
  if (!Number.isFinite(sourceId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [source] = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.userId, userId)));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }
  if (source.type !== "website") {
    res.status(400).json({ error: "Retry crawl is only for website knowledge" });
    return;
  }

  let failedUrls = parseFailedUrls(source.crawlFailedUrls);
  // Fallback: rediscover from seed + skip already-indexed keywords.
  const existing = await db
    .select({ keywords: knowledgeEntriesTable.keywords })
    .from(knowledgeEntriesTable)
    .where(eq(knowledgeEntriesTable.sourceId, sourceId));
  const indexed = new Set(
    existing.map((e) => (e.keywords ?? "").trim()).filter((u) => /^https?:\/\//i.test(u)),
  );
  const seedUrl = [...indexed][0] ?? failedUrls[0];
  if (!seedUrl) {
    res.status(400).json({ error: "No website URL to retry from" });
    return;
  }

  await db.update(knowledgeSourcesTable)
    .set({ status: "crawling", updatedAt: new Date() })
    .where(eq(knowledgeSourcesTable.id, sourceId));

  res.json({ started: true, pendingUrls: failedUrls.length || "rediscover" });

  const CRAWLER_UA = "Mozilla/5.0 (compatible; VoiceOrch-KB-Crawler/1.0)";
  void (async () => {
    let baseUrl: URL;
    try { baseUrl = new URL(seedUrl); } catch {
      await db.update(knowledgeSourcesTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(knowledgeSourcesTable.id, sourceId));
      return;
    }

    if (!failedUrls.length) {
      try {
        const r = await safeFetch(seedUrl, {
          headers: { "User-Agent": CRAWLER_UA },
          signal: AbortSignal.timeout(15_000),
        }, SAFE_FETCH_MAX_REDIRECTS, baseUrl.hostname);
        if (r.ok) {
          const html = await r.text();
          failedUrls = extractSameOriginLinks(html, baseUrl).filter((u) => !indexed.has(u));
        }
      } catch (err) {
        logger.warn({ err, sourceId }, "KB retry-crawl: rediscover failed");
      }
    }

    const stillFailed: string[] = [];
    let added = 0;
    for (const pageUrl of failedUrls.slice(0, 30)) {
      if (indexed.has(pageUrl)) continue;
      try {
        const r = await safeFetch(pageUrl, {
          headers: { "User-Agent": CRAWLER_UA },
          signal: AbortSignal.timeout(10_000),
        }, SAFE_FETCH_MAX_REDIRECTS, baseUrl.hostname);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const html = await r.text();
        const title = extractTitle(html) || pageUrl;
        const meta = extractMetaDescription(html);
        const body = stripHtml(html);
        const parts: string[] = [title];
        if (meta && meta !== title) parts.push(meta);
        if (body.length > title.length + 20) parts.push(body.slice(0, 12_000));
        const text = parts.join("\n\n").slice(0, 15_000);
        if (!text.trim()) { stillFailed.push(pageUrl); continue; }
        await db.insert(knowledgeEntriesTable).values({
          sourceId, userId, title, content: text, keywords: pageUrl,
        });
        indexed.add(pageUrl);
        added++;
      } catch (err) {
        stillFailed.push(pageUrl);
        logger.warn({ err, pageUrl, sourceId }, "KB retry-crawl: page failed");
      }
    }

    await syncEntryCount(sourceId);
    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(knowledgeEntriesTable)
      .where(eq(knowledgeEntriesTable.sourceId, sourceId));
    const entryCount = Number(countRow?.n) || 0;
    const finalStatus = entryCount === 0 ? "failed"
      : stillFailed.length > 0 ? "partial"
      : "ready";
    await db.update(knowledgeSourcesTable)
      .set({
        status: finalStatus,
        entryCount,
        crawlFailedUrls: stillFailed.length ? JSON.stringify(stillFailed) : null,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSourcesTable.id, sourceId));
    logger.info({ sourceId, added, stillFailed: stillFailed.length, finalStatus }, "KB retry-crawl complete");
    kickKbEmbedWorker();
    kickKrutrimSummaryWorker();
  })().catch((err) => {
    logger.warn({ err, sourceId }, "KB retry-crawl unhandled");
    db.update(knowledgeSourcesTable)
      .set({ status: "partial", updatedAt: new Date() })
      .where(eq(knowledgeSourcesTable.id, sourceId))
      .catch(() => {});
  });
});

export default router;
