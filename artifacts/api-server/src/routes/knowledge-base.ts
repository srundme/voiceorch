import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, knowledgeSourcesTable, knowledgeEntriesTable, platformSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
const router: IRouter = Router();

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Fetch the managed Qwen API key (platform_settings → env fallback) */
async function getQwenKey(): Promise<string | null> {
  try {
    const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_qwen_key"));
    const dbVal = (row?.value ?? "").trim();
    if (dbVal) return dbVal;
  } catch { /* fall through */ }
  const envVal = (process.env["GROQ_API_KEY"] ?? "").trim();
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

  // Build content: always start with title, add meta description if it differs,
  // then body text (first 15 000 chars) de-duplicated against title/meta
  const unique: string[] = [title];
  if (meta && meta !== title) unique.push(meta);
  // Body often repeats title — only add distinct body text
  const bodyClean = body.length > title.length + 20 ? body : "";
  if (bodyClean) unique.push(bodyClean.slice(0, 15_000));

  return { title, content: unique.join("\n\n").slice(0, 20_000) };
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
  const { query } = req.body as { query: string };

  if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }

  const [source] = await db
    .select({ id: knowledgeSourcesTable.id })
    .from(knowledgeSourcesTable)
    .where(and(eq(knowledgeSourcesTable.id, sourceId), eq(knowledgeSourcesTable.userId, userId)));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }

  const q = query.trim();

  // Load ALL entries (up to 200) — Qwen reads everything directly, no keyword guessing
  const allEntries = await db
    .select()
    .from(knowledgeEntriesTable)
    .where(and(
      eq(knowledgeEntriesTable.sourceId, sourceId),
      eq(knowledgeEntriesTable.userId, userId),
    ))
    .limit(200);

  if (!allEntries.length) {
    res.json({ answer: "This knowledge source has no entries yet.", matchedEntries: [] });
    return;
  }

  const qwenKey = await getQwenKey();
  if (!qwenKey) {
    // No LLM key — return raw entries so the caller can display them
    res.json({
      answer: allEntries.map(e => e.title ? `${e.title}: ${e.content}` : e.content).join("\n\n"),
      matchedEntries: allEntries.map(e => ({ entry: e, rank: 0.5, snippet: null })),
    });
    return;
  }

  // Build full knowledge context — Qwen reads all entries and decides what's relevant
  const context = allEntries
    .map((e, i) => [
      `[${i}]`,
      e.title ? `Title: ${e.title}` : null,
      `Content: ${e.content}`,
      e.keywords ? `Keywords: ${e.keywords}` : null,
    ].filter(Boolean).join("\n"))
    .join("\n\n---\n\n");

  const prompt = `You are a helpful knowledge base assistant. Read all the knowledge entries below and answer the user's question accurately.

Knowledge Entries:
${context}

User Question: ${q}

Instructions:
- Answer using ONLY information from the knowledge entries above.
- Also return which entry indices (0-based numbers from [0], [1], etc.) are relevant.
- If the answer is not covered, set answer to "I don't have information about this in my knowledge base."
- Respond with ONLY valid JSON, no markdown, no explanation outside the JSON:
{"answer":"...","relevantIndices":[0,1]}`;

  try {
    const qwenRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${qwenKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen/qwen3-32b",
          temperature: 0.3,
          max_tokens: 1024,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You are a helpful knowledge base assistant. Always respond with valid JSON only." },
            { role: "user", content: prompt },
          ],
        }),
      },
    );

    if (!qwenRes.ok) {
      throw new Error(`Qwen API error: ${qwenRes.status}`);
    }

    const data = (await qwenRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data?.choices?.[0]?.message?.content?.trim() ?? "";

    let answer = "Unable to process the question.";
    let relevantIndices: number[] = [];

    try {
      const parsed = JSON.parse(text) as { answer?: string; relevantIndices?: number[] };
      answer = parsed.answer?.trim() || answer;
      relevantIndices = Array.isArray(parsed.relevantIndices) ? parsed.relevantIndices : [];
    } catch {
      answer = text;
    }

    const matchedEntries = relevantIndices
      .filter(i => Number.isInteger(i) && i >= 0 && i < allEntries.length)
      .map(i => ({ entry: allEntries[i]!, rank: 1.0, snippet: null }));

    res.json({ answer, matchedEntries });
  } catch (err) {
    logger.warn({ err }, "KB search LLM failed");
    res.json({
      answer: allEntries.map(e => e.title ? `${e.title}: ${e.content}` : e.content).join("\n\n"),
      matchedEntries: allEntries.map(e => ({ entry: e, rank: 0.5, snippet: null })),
    });
  }
});

export default router;
