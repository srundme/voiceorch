import { db, kbChunksTable, platformSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

const GEMINI_EMBED_MODELS = ["text-embedding-004", "embedding-001"] as const;

/** Embed a single query text via the official Gemini SDK.
 *  Tries text-embedding-004 first; falls back to embedding-001 if unavailable. */
async function embedQuery(text: string, geminiKey: string): Promise<number[] | null> {
  const genAI = new GoogleGenerativeAI(geminiKey);
  for (const modelName of GEMINI_EMBED_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (msg.includes("404") || msg.includes("not found") || msg.includes("not supported")) {
        continue;
      }
      logger.warn({ err }, "Gemini KB query embedding failed");
      return null;
    }
  }
  logger.warn("No Gemini embedding model available for this API key");
  return null;
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
