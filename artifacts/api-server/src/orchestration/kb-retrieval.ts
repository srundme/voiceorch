import { db, kbChunksTable, platformSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

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

/** Embed a single text string using Gemini text-embedding-004 (768 dims) */
async function embedQuery(text: string, geminiKey: string): Promise<number[] | null> {
  const resp = await fetch(
    "https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    }
  );
  if (!resp.ok) {
    logger.warn({ status: resp.status }, "Gemini KB query embedding failed");
    return null;
  }
  const data = await resp.json() as { embedding?: { values: number[] } };
  return data.embedding?.values ?? null;
}

/**
 * Embed `query` using Gemini text-embedding-004, then retrieve the top-K
 * most semantically similar chunks from the knowledge base via pgvector cosine
 * distance.  Returns a formatted string ready to inject into the LLM system
 * prompt, or an empty string if the KB is empty or retrieval fails.
 */
export async function retrieveKbContext(
  knowledgeBaseId: number,
  query: string,
  topK = 3,
): Promise<string> {
  const geminiKey = await getGeminiKey();
  if (!geminiKey) {
    logger.warn({ knowledgeBaseId }, "Gemini key not configured — KB retrieval skipped");
    return "";
  }

  const embedding = await embedQuery(query, geminiKey);
  if (!embedding?.length) return "";

  // Cosine similarity search via pgvector
  const embeddingStr = `[${embedding.join(",")}]`;

  const rows = await db
    .select({ content: kbChunksTable.content })
    .from(kbChunksTable)
    .where(eq(kbChunksTable.knowledgeBaseId, knowledgeBaseId))
    .orderBy(sql`embedding <=> ${embeddingStr}::vector`)
    .limit(topK);

  if (!rows.length) return "";

  return rows.map(r => r.content).join("\n\n---\n\n");
}
