import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, knowledgeBasesTable, kbDocumentsTable, kbChunksTable, platformSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router: IRouter = Router();

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Estimate token count (~4 chars/token for English) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Recursive character text splitter.
 * Splits on paragraph → sentence → word boundaries, falling back to hard cut.
 */
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const SEPARATORS = ["\n\n", "\n", ". ", " ", ""];
  const chunks: string[] = [];

  function split(t: string, separators: string[]): string[] {
    if (estimateTokens(t) <= chunkSize) return [t];
    if (separators.length === 0) {
      // Hard cut at char level (~4 chars per token)
      const maxChars = chunkSize * 4;
      const pieces: string[] = [];
      for (let i = 0; i < t.length; i += maxChars) pieces.push(t.slice(i, i + maxChars));
      return pieces;
    }
    const [sep, ...rest] = separators;
    if (!sep) return split(t, rest);
    const parts = t.split(sep).filter(p => p.trim());
    const merged: string[] = [];
    let current = "";
    for (const part of parts) {
      const candidate = current ? current + sep + part : part;
      if (estimateTokens(candidate) <= chunkSize) {
        current = candidate;
      } else {
        if (current) merged.push(current);
        if (estimateTokens(part) > chunkSize) {
          merged.push(...split(part, rest));
          current = "";
        } else {
          current = part;
        }
      }
    }
    if (current) merged.push(current);
    return merged;
  }

  const rawChunks = split(text, SEPARATORS);

  // Apply overlap: each chunk gets the tail of the previous chunk prepended
  for (let i = 0; i < rawChunks.length; i++) {
    if (i === 0) {
      chunks.push(rawChunks[i]!);
    } else {
      const prev = rawChunks[i - 1]!;
      const overlapChars = overlap * 4;
      const overlapText = prev.slice(-overlapChars);
      chunks.push(overlapText + rawChunks[i]!);
    }
  }

  return chunks.filter(c => c.trim().length > 0);
}

/** Fetch URL content (plain text or HTML stripped) */
async function fetchUrl(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "VoiceOrch-RAG/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (contentType.includes("text/html")) {
    // Strip HTML tags, normalize whitespace
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return text;
}

/** Fetch the managed Gemini API key (platform_settings → env fallback) */
async function getGeminiKey(): Promise<string | null> {
  const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_gemini_key"));
  const dbVal = (row?.value ?? "").trim();
  if (dbVal) return dbVal;
  const envVal = (process.env["GEMINI_API_KEY"] ?? "").trim();
  return envVal || null;
}

/** Gemini embedding models to try in preference order (both produce 768-dim vectors) */
const GEMINI_EMBED_MODELS = ["text-embedding-004", "embedding-001"] as const;

/** Generate embeddings for a batch of texts via the official Gemini SDK.
 *  Tries text-embedding-004 first; falls back to embedding-001 if unavailable. */
async function embedTexts(texts: string[], geminiKey: string): Promise<number[][]> {
  const genAI = new GoogleGenerativeAI(geminiKey);
  let lastErr: unknown;
  for (const modelName of GEMINI_EMBED_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const results = await Promise.all(texts.map(text => model.embedContent(text)));
      return results.map(r => r.embedding.values);
    } catch (err: unknown) {
      lastErr = err;
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (msg.includes("404") || msg.includes("not found") || msg.includes("not supported")) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("No Gemini embedding model is available for this API key");
}

/** Cosine similarity between two unit-ish vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Full ingestion pipeline — runs async (fire and forget after response) */
async function ingestDocument(docId: number, kbId: number, content: string, chunkSize: number, chunkOverlap: number): Promise<void> {
  try {
    await db.update(kbDocumentsTable)
      .set({ status: "processing" })
      .where(eq(kbDocumentsTable.id, docId));

    const apiKey = await getGeminiKey();
    if (!apiKey) throw new Error("Gemini API key not configured. Contact your platform admin.");

    const chunks = chunkText(content, chunkSize, chunkOverlap);
    if (chunks.length === 0) throw new Error("No text content found after chunking");

    // Embed in batches of 100 (OpenAI limit)
    const BATCH = 100;
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const embeddings = await embedTexts(batch, apiKey);
      allEmbeddings.push(...embeddings);
    }

    // Insert chunks
    await db.delete(kbChunksTable).where(eq(kbChunksTable.documentId, docId));
    const rows = chunks.map((c, idx) => ({
      documentId: docId,
      knowledgeBaseId: kbId,
      chunkIndex: idx,
      content: c,
      tokenCount: estimateTokens(c),
      chunkEmbedding: allEmbeddings[idx]!,
      metadata: { chunkIndex: idx } as Record<string, unknown>,
    }));

    // Insert in batches
    for (let i = 0; i < rows.length; i += 50) {
      await db.insert(kbChunksTable).values(rows.slice(i, i + 50));
    }

    // Update document + KB counters
    await db.update(kbDocumentsTable)
      .set({ status: "ready", chunkCount: chunks.length, processingError: null })
      .where(eq(kbDocumentsTable.id, docId));

    // Recalculate KB aggregates
    const agg = await db
      .select({
        docCount: sql<number>`count(distinct ${kbDocumentsTable.id})`,
        chunkTotal: sql<number>`coalesce(sum(${kbDocumentsTable.chunkCount}), 0)`,
      })
      .from(kbDocumentsTable)
      .where(and(eq(kbDocumentsTable.knowledgeBaseId, kbId), eq(kbDocumentsTable.status, "ready")));

    await db.update(knowledgeBasesTable)
      .set({ documentCount: Number(agg[0]?.docCount ?? 0), chunkCount: Number(agg[0]?.chunkTotal ?? 0) })
      .where(eq(knowledgeBasesTable.id, kbId));

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(kbDocumentsTable)
      .set({ status: "error", processingError: msg })
      .where(eq(kbDocumentsTable.id, docId));
  }
}

/* ── Routes ──────────────────────────────────────────────────────────────── */

// List all knowledge bases (scoped to the authenticated user)
router.get("/knowledge-bases", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const kbs = await db.select().from(knowledgeBasesTable)
    .where(eq(knowledgeBasesTable.userId, clerkId))
    .orderBy(knowledgeBasesTable.createdAt);
  res.json(kbs);
});

// Create knowledge base (associates with authenticated user)
router.post("/knowledge-bases", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { name, description, embeddingModel, chunkSize, chunkOverlap } = req.body as {
    name?: string; description?: string; embeddingModel?: string; chunkSize?: number; chunkOverlap?: number;
  };
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const [kb] = await db.insert(knowledgeBasesTable).values({
    userId: clerkId,
    name: name.trim(),
    description: description ?? undefined,
    embeddingModel: embeddingModel ?? "embedding-001",
    chunkSize: chunkSize ?? 512,
    chunkOverlap: chunkOverlap ?? 64,
  }).returning();
  res.status(201).json(kb);
});

// Get KB with documents (ownership enforced)
router.get("/knowledge-bases/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const [kb] = await db.select().from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, id), eq(knowledgeBasesTable.userId, clerkId)));
  if (!kb) { res.status(404).json({ error: "Not found" }); return; }
  const documents = await db.select().from(kbDocumentsTable)
    .where(eq(kbDocumentsTable.knowledgeBaseId, id))
    .orderBy(kbDocumentsTable.createdAt);
  res.json({ ...kb, documents });
});

// Update KB (ownership enforced)
router.patch("/knowledge-bases/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const { name, description } = req.body as { name?: string; description?: string };
  const [kb] = await db.update(knowledgeBasesTable)
    .set({ ...(name ? { name } : {}), ...(description !== undefined ? { description } : {}) })
    .where(and(eq(knowledgeBasesTable.id, id), eq(knowledgeBasesTable.userId, clerkId)))
    .returning();
  if (!kb) { res.status(404).json({ error: "Not found" }); return; }
  res.json(kb);
});

// Delete KB (ownership enforced; cascades to documents + chunks)
router.delete("/knowledge-bases/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const [kb] = await db.select({ id: knowledgeBasesTable.id })
    .from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, id), eq(knowledgeBasesTable.userId, clerkId)));
  if (!kb) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(knowledgeBasesTable).where(eq(knowledgeBasesTable.id, id));
  res.status(204).end();
});

// List documents (KB ownership enforced)
router.get("/knowledge-bases/:id/documents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const [kb] = await db.select({ id: knowledgeBasesTable.id })
    .from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, id), eq(knowledgeBasesTable.userId, clerkId)));
  if (!kb) { res.status(404).json({ error: "Not found" }); return; }
  const docs = await db.select().from(kbDocumentsTable)
    .where(eq(kbDocumentsTable.knowledgeBaseId, id))
    .orderBy(kbDocumentsTable.createdAt);
  res.json(docs);
});

// Add document — async ingestion (KB ownership enforced)
router.post("/knowledge-bases/:id/documents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const kbId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(kbId)) { res.status(400).json({ error: "invalid id" }); return; }

  const [kb] = await db.select().from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, kbId), eq(knowledgeBasesTable.userId, clerkId)));
  if (!kb) { res.status(404).json({ error: "Knowledge base not found" }); return; }

  const { name, sourceType, content, sourceUrl } = req.body as {
    name?: string; sourceType?: string; content?: string; sourceUrl?: string;
  };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  if (!sourceType || !["text", "url"].includes(sourceType)) {
    res.status(400).json({ error: "sourceType must be 'text' or 'url'" });
    return;
  }
  if (sourceType === "text" && !content?.trim()) {
    res.status(400).json({ error: "content is required for sourceType=text" });
    return;
  }
  if (sourceType === "url" && !sourceUrl?.trim()) {
    res.status(400).json({ error: "sourceUrl is required for sourceType=url" });
    return;
  }

  const rawContent = sourceType === "text" ? (content ?? "") : "";
  const [doc] = await db.insert(kbDocumentsTable).values({
    knowledgeBaseId: kbId,
    name: name.trim(),
    sourceType,
    sourceUrl: sourceUrl ?? undefined,
    charCount: rawContent.length || undefined,
    status: "pending",
  }).returning();

  // Fire-and-forget ingestion
  const resolveContent = async (): Promise<string> => {
    if (sourceType === "url" && sourceUrl) return fetchUrl(sourceUrl);
    return rawContent;
  };

  resolveContent().then(text =>
    ingestDocument(doc!.id, kbId, text, kb.chunkSize, kb.chunkOverlap)
  ).catch(() => {
    // Error is captured inside ingestDocument
  });

  res.status(202).json(doc);
});

// Delete document (KB ownership enforced)
router.delete("/knowledge-bases/:id/documents/:docId", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const kbId = parseInt(String(req.params["id"] ?? ""), 10);
  const docId = parseInt(String(req.params["docId"] ?? ""), 10);
  if (isNaN(kbId) || isNaN(docId)) { res.status(400).json({ error: "invalid id" }); return; }
  const [kb] = await db.select({ id: knowledgeBasesTable.id })
    .from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, kbId), eq(knowledgeBasesTable.userId, clerkId)));
  if (!kb) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(kbDocumentsTable)
    .where(and(eq(kbDocumentsTable.id, docId), eq(kbDocumentsTable.knowledgeBaseId, kbId)));

  // Recalculate KB aggregates
  const agg = await db
    .select({
      docCount: sql<number>`count(distinct ${kbDocumentsTable.id})`,
      chunkTotal: sql<number>`coalesce(sum(${kbDocumentsTable.chunkCount}), 0)`,
    })
    .from(kbDocumentsTable)
    .where(and(eq(kbDocumentsTable.knowledgeBaseId, kbId), eq(kbDocumentsTable.status, "ready")));
  await db.update(knowledgeBasesTable)
    .set({ documentCount: Number(agg[0]?.docCount ?? 0), chunkCount: Number(agg[0]?.chunkTotal ?? 0) })
    .where(eq(knowledgeBasesTable.id, kbId));

  res.status(204).end();
});

// Query (test retrieval) — hybrid vector + FTS with RRF (KB ownership enforced)
router.post("/knowledge-bases/:id/query", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const kbId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(kbId)) { res.status(400).json({ error: "invalid id" }); return; }
  const { query, topK = 5 } = req.body as { query?: string; topK?: number };
  if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }

  const [kb] = await db.select().from(knowledgeBasesTable)
    .where(and(eq(knowledgeBasesTable.id, kbId), eq(knowledgeBasesTable.userId, clerkId)));
  if (!kb) { res.status(404).json({ error: "Not found" }); return; }

  const apiKey = await getGeminiKey();
  if (!apiKey) {
    res.status(400).json({ error: "Gemini API key not configured. Contact your platform admin." });
    return;
  }

  // Embed the query
  const [queryEmbedding] = await embedTexts([query.trim()], apiKey);
  if (!queryEmbedding) { res.status(500).json({ error: "Failed to embed query" }); return; }

  // Fetch all ready chunks for this KB (with document name)
  const chunks = await db
    .select({
      id: kbChunksTable.id,
      content: kbChunksTable.content,
      chunkIndex: kbChunksTable.chunkIndex,
      documentId: kbChunksTable.documentId,
      chunkEmbedding: kbChunksTable.chunkEmbedding,
      documentName: kbDocumentsTable.name,
    })
    .from(kbChunksTable)
    .innerJoin(kbDocumentsTable, eq(kbChunksTable.documentId, kbDocumentsTable.id))
    .where(and(
      eq(kbChunksTable.knowledgeBaseId, kbId),
      eq(kbDocumentsTable.status, "ready"),
    ));

  if (chunks.length === 0) {
    res.json([]);
    return;
  }

  // Vector similarity scores
  const queryLower = query.toLowerCase();
  const scored = chunks.map((c, i) => {
    const vecScore = c.chunkEmbedding ? cosineSimilarity(queryEmbedding, c.chunkEmbedding) : 0;
    // Simple BM25-ish keyword score (term frequency proxy)
    const words = queryLower.split(/\s+/).filter(Boolean);
    const contentLower = c.content.toLowerCase();
    const kwScore = words.reduce((acc, w) => acc + (contentLower.split(w).length - 1), 0) / Math.max(words.length, 1);
    // RRF-style fusion (vector rank + keyword rank)
    return { ...c, vecScore, kwScore, score: 0, rankVec: 0, rankKw: 0, i };
  });

  // Rank by vector score
  const byVec = [...scored].sort((a, b) => b.vecScore - a.vecScore);
  byVec.forEach((c, rank) => { scored[c.i]!.rankVec = rank + 1; });

  // Rank by keyword score
  const byKw = [...scored].sort((a, b) => b.kwScore - a.kwScore);
  byKw.forEach((c, rank) => { scored[c.i]!.rankKw = rank + 1; });

  // RRF score = 1/(k+rankVec) + 1/(k+rankKw)  k=60
  const K = 60;
  for (const c of scored) {
    c.score = 1 / (K + c.rankVec) + 1 / (K + c.rankKw);
  }

  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(c => ({
      content: c.content,
      score: parseFloat(c.score.toFixed(6)),
      documentId: c.documentId,
      documentName: c.documentName,
      chunkIndex: c.chunkIndex,
    }));

  res.json(top);
});

export default router;
