import { db, kbChunksTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * Embed `query` using OpenAI text-embedding-3-small, then retrieve the top-K
 * most semantically similar chunks from the knowledge base via pgvector cosine
 * distance.  Returns a formatted string ready to inject into the LLM system
 * prompt, or an empty string if the KB is empty or retrieval fails.
 */
export async function retrieveKbContext(
  knowledgeBaseId: number,
  query: string,
  openaiKey: string,
  topK = 3,
): Promise<string> {
  // 1. Generate query embedding via OpenAI
  const embResp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
  });

  if (!embResp.ok) {
    logger.warn({ status: embResp.status, knowledgeBaseId }, "KB embedding request failed");
    return "";
  }

  const embData = await embResp.json() as { data: Array<{ embedding: number[] }> };
  const embedding = embData.data[0]?.embedding;
  if (!embedding?.length) return "";

  // 2. Cosine similarity search via pgvector
  // The column in the DB is named "embedding"; we use raw SQL for the <=> operator.
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
