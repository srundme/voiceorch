import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, knowledgeSourcesTable, knowledgeEntriesTable, platformSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router: IRouter = Router();

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Fetch the managed Gemini API key (platform_settings → env fallback) */
async function getGeminiKey(): Promise<string | null> {
  try {
    const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_gemini_key"));
    const dbVal = (row?.value ?? "").trim();
    if (dbVal) return dbVal;
  } catch { /* fall through */ }
  const envVal = (process.env["GEMINI_API_KEY"] ?? "").trim();
  return envVal || null;
}

/** Strip HTML tags and collapse whitespace */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
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

/** Crawl a URL and return { title, content } */
async function crawlUrl(url: string): Promise<{ title: string; content: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "VoiceOrch-KB-Crawler/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  return { title: extractTitle(html), content: stripHtml(html).slice(0, 20_000) };
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

router.get("/knowledge-sources", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const sources = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(eq(knowledgeSourcesTable.userId, userId))
    .orderBy(sql`created_at DESC`);
  res.json(sources);
});

/* ── Create ──────────────────────────────────────────────────────────────── */

router.post("/knowledge-sources", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { name, type, url, entries = [] } = req.body as {
    name: string;
    type: "faq" | "text" | "website";
    url?: string;
    entries?: Array<{ title?: string; content: string; keywords?: string }>;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!["faq", "text", "website"].includes(type)) {
    res.status(400).json({ error: "type must be faq, text, or website" });
    return;
  }

  // Create source with processing status for website crawl
  const status = type === "website" ? "processing" : "active";
  const [source] = await db
    .insert(knowledgeSourcesTable)
    .values({ userId, name: name.trim(), type, status })
    .returning();

  const createdEntries: typeof knowledgeEntriesTable.$inferSelect[] = [];

  if (type === "website") {
    // Crawl in background
    if (!url?.trim()) {
      await db.delete(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, source!.id));
      res.status(400).json({ error: "url is required for type=website" });
      return;
    }
    const sourceId = source!.id;
    const crawlUrl_ = url.trim();
    (async () => {
      try {
        const { title, content } = await crawlUrl(crawlUrl_);
        const [entry] = await db.insert(knowledgeEntriesTable).values({
          sourceId,
          userId,
          title,
          content,
          keywords: crawlUrl_,
        }).returning();
        await db.update(knowledgeSourcesTable)
          .set({ status: "active", entryCount: 1, updatedAt: new Date() })
          .where(eq(knowledgeSourcesTable.id, sourceId));
        logger.info({ sourceId, url: crawlUrl_ }, "KB website crawl complete");
        void entry;
      } catch (err) {
        await db.update(knowledgeSourcesTable)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(knowledgeSourcesTable.id, sourceId));
        logger.warn({ err, sourceId, url: crawlUrl_ }, "KB website crawl failed");
      }
    })().catch(() => {});
  } else {
    // Insert provided entries
    for (const e of entries) {
      if (!e.content?.trim()) continue;
      const [entry] = await db.insert(knowledgeEntriesTable).values({
        sourceId: source!.id,
        userId,
        title: e.title?.trim() || null,
        content: e.content.trim(),
        keywords: e.keywords?.trim() || null,
      }).returning();
      createdEntries.push(entry!);
    }
    await syncEntryCount(source!.id);
  }

  const [refreshed] = await db.select().from(knowledgeSourcesTable).where(eq(knowledgeSourcesTable.id, source!.id));
  res.status(201).json({ ...refreshed, entries: createdEntries });
});

/* ── Get detail ──────────────────────────────────────────────────────────── */

router.get("/knowledge-sources/:id", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const id = Number(req.params["id"]);
  const [source] = await db
    .select()
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, id), eq(knowledgeSourcesTable.userId, userId)));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }

  const entries = await db
    .select()
    .from(knowledgeEntriesTable)
    .where(eq(knowledgeEntriesTable.sourceId, id))
    .orderBy(sql`created_at ASC`);

  res.json({ ...source, entries });
});

/* ── Update (rename) ─────────────────────────────────────────────────────── */

router.patch("/knowledge-sources/:id", requireAuth, async (req, res) => {
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

router.delete("/knowledge-sources/:id", requireAuth, async (req, res) => {
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

router.post("/knowledge-sources/:id/entries", requireAuth, async (req, res) => {
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
  }).returning();

  await syncEntryCount(sourceId);
  res.status(201).json(entry);
});

/* ── Update entry ────────────────────────────────────────────────────────── */

router.patch("/knowledge-sources/:id/entries/:entryId", requireAuth, async (req, res) => {
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
    })
    .where(and(
      eq(knowledgeEntriesTable.id, entryId),
      eq(knowledgeEntriesTable.sourceId, sourceId),
      eq(knowledgeEntriesTable.userId, userId),
    ))
    .returning();

  if (!entry) { res.status(404).json({ error: "Not found" }); return; }
  res.json(entry);
});

/* ── Delete entry ────────────────────────────────────────────────────────── */

router.delete("/knowledge-sources/:id/entries/:entryId", requireAuth, async (req, res) => {
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
    .returning();

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  await syncEntryCount(sourceId);
  res.status(204).end();
});

/* ── Search (test panel) ─────────────────────────────────────────────────── */

router.post("/knowledge-sources/:id/search", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const sourceId = Number(req.params["id"]);
  const { query, limit = 5 } = req.body as { query: string; limit?: number };

  if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }

  const [source] = await db
    .select({ id: knowledgeSourcesTable.id })
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.userId, userId)));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }

  const searchLimit = Math.min(Number(limit) || 5, 10);

  // PostgreSQL Full Text Search
  const rows = await db.execute<{
    id: number;
    source_id: number;
    user_id: string;
    title: string | null;
    content: string;
    keywords: string | null;
    created_at: string;
    rank: number;
    snippet: string | null;
  }>(sql`
    SELECT
      ke.id,
      ke.source_id,
      ke.user_id,
      ke.title,
      ke.content,
      ke.keywords,
      ke.created_at,
      ts_rank(
        to_tsvector('english', coalesce(ke.title,'') || ' ' || ke.content || ' ' || coalesce(ke.keywords,'')),
        plainto_tsquery('english', ${query.trim()})
      ) AS rank,
      ts_headline(
        'english',
        ke.content,
        plainto_tsquery('english', ${query.trim()}),
        'MaxWords=30, MinWords=15, StartSel=<mark>, StopSel=</mark>'
      ) AS snippet
    FROM knowledge_entries ke
    WHERE
      ke.source_id = ${sourceId}
      AND ke.user_id = ${userId}
      AND to_tsvector('english', coalesce(ke.title,'') || ' ' || ke.content || ' ' || coalesce(ke.keywords,''))
          @@ plainto_tsquery('english', ${query.trim()})
    ORDER BY rank DESC
    LIMIT ${searchLimit}
  `);

  const matchedEntries = rows.rows.map(r => ({
    entry: {
      id: r.id,
      sourceId: r.source_id,
      title: r.title,
      content: r.content,
      keywords: r.keywords,
      createdAt: r.created_at,
    },
    rank: Number(r.rank),
    snippet: r.snippet ?? null,
  }));

  // Generate LLM answer using Gemini if available
  let answer = "No matching knowledge found for your question.";
  if (matchedEntries.length > 0) {
    const geminiKey = await getGeminiKey();
    if (geminiKey) {
      try {
        const knowledgeContext = matchedEntries
          .map((m, i) => `[${i + 1}] ${m.entry.title ? `${m.entry.title}\n` : ""}${m.entry.content}`)
          .join("\n\n---\n\n");
        const prompt = `You are a helpful assistant. Answer the user's question using ONLY the provided knowledge. If the answer is not in the knowledge, say you don't know.

Relevant Knowledge:
${knowledgeContext}

Question: ${query.trim()}

Answer:`;

        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        answer = result.response.text().trim();
      } catch (err) {
        logger.warn({ err }, "KB search LLM answer failed");
        answer = matchedEntries
          .map(m => m.entry.title ? `${m.entry.title}: ${m.entry.content}` : m.entry.content)
          .join("\n\n");
      }
    } else {
      // No LLM — return the matched content directly
      answer = matchedEntries
        .map(m => m.entry.title ? `${m.entry.title}: ${m.entry.content}` : m.entry.content)
        .join("\n\n");
    }
  }

  res.json({ answer, matchedEntries });
});

export default router;
