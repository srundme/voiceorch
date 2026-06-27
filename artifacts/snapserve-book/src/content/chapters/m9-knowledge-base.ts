import type { Chapter } from "../types";

export const knowledgeBase: Chapter = {
  slug: "knowledge-base",
  moduleId: "m9",
  number: "10.2",
  title: "Knowledge Base & Full-Text Search",
  summary:
    "How SnapServe injects agent-specific documents into the LLM's context using PostgreSQL full-text search — no embeddings, no pgvector.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/orchestration/kb-retrieval.ts",
  prerequisites: ["tools-dispatch", "llm-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What is a Knowledge Base?",
      paragraphs: [
        "A knowledge base (KB) is a collection of documents an agent can draw on when answering questions. Without a KB, the agent only knows what's in its system prompt and the current conversation. With a KB, it can look up specific facts: product pricing, return policies, FAQs, procedures, anything an operator wants the agent to know.",
        "SnapServe's KB system is deliberately simple. It uses **PostgreSQL full-text search** (FTS) — the same database you're already using, no extra infrastructure, no embeddings, no vector database. FTS has been battle-tested since the 1990s and is surprisingly effective for the structured, domain-specific queries a voice agent makes.",
      ],
    },
    {
      kind: "concept",
      title: "Full-text search vs. semantic search",
      body: [
        "**Semantic search** (the buzzword approach) converts both the query and every document into high-dimensional numerical vectors via an embedding model, then finds documents whose vectors are closest to the query vector. It's powerful for open-domain retrieval because it understands meaning: 'car' and 'automobile' are close in vector space.",
        "**Full-text search** tokenises documents into words (terms), builds an inverted index (a map from term → documents containing it), and matches queries against the index using relevance scoring (TF-IDF or BM25). It's fast, portable, and exactly what you need when your documents use consistent vocabulary — which agent knowledge bases almost always do.",
        "For a voice agent's KB (\"What are your business hours?\" → FAQ entry about hours), FTS is not a compromise. It's the right tool. You avoid embedding model costs, latency, and the complexity of managing a vector index. The single dependency is PostgreSQL — which SnapServe already requires.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/kb-retrieval.ts",
      language: "typescript",
      intro:
        "The `retrieveKbChunks` function — the core of the retrieval system. It queries `knowledge_entries` using PostgreSQL FTS, filtered to the sources attached to the current agent.",
      code: `export async function retrieveKbChunks(
  query: string,
  sourceIds: number[],
  opts: { limit?: number } = {}
): Promise<string[]> {
  if (!query || sourceIds.length === 0) return [];
  const limit = opts.limit ?? 5;

  const rows = await db.execute<{ content: string; rank: number }>(sql\`
    SELECT content,
           ts_rank_cd(search_vector, plainto_tsquery('english', \${query})) AS rank
    FROM knowledge_entries
    WHERE source_id = ANY(\${sourceIds})
      AND search_vector @@ plainto_tsquery('english', \${query})
    ORDER BY rank DESC
    LIMIT \${limit}
  \`);

  return rows.map(r => r.content);
}`,
      lines: [
        {
          lines: "9-16",
          label: "the FTS query",
          explanation:
            "`search_vector` is a `tsvector` column on `knowledge_entries` — a preprocessed list of normalised tokens. The `@@` operator asks PostgreSQL: 'does this document match this query?' `plainto_tsquery` converts the natural language query string into a query tree without needing the caller to know tsquery syntax.",
        },
        {
          lines: "10-11",
          label: "ts_rank_cd",
          explanation:
            "`ts_rank_cd` scores matches by term frequency (how often the query terms appear) and proximity (terms close together score higher). The `_cd` variant also factors in the **cover density** — how densely the matching terms are packed. Rows are returned highest-rank first.",
        },
        {
          lines: "12-13",
          label: "source_id filter",
          explanation:
            "`source_id = ANY(sourceIds)` limits retrieval to the sources attached to THIS agent. Different agents can share documents (by referencing the same source) or have private ones. The source IDs were resolved at session start via `getAttachedSourceIds`.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "How entries are indexed",
      paragraphs: [
        "When an operator adds content to a knowledge source, the API (`routes/knowledge-base.ts`) splits it into chunks and inserts them as rows in `knowledge_entries`. Each row gets a `search_vector` column populated by a PostgreSQL `to_tsvector('english', content)` call.",
        "A GIN index on `search_vector` makes FTS queries fast even with millions of entries. GIN (Generalised Inverted Index) is PostgreSQL's optimised index type for full-text search — it's the FTS equivalent of an inverted index in a search engine.",
        "The chunking strategy matters. Long documents are split at paragraph or sentence boundaries, not mid-sentence. Each chunk is typically 200-500 words — long enough to have meaningful context for the FTS scorer, short enough to fit comfortably in the LLM's context window when retrieved.",
      ],
    },
    {
      kind: "code",
      filename: "routes/knowledge-base.ts",
      language: "typescript",
      intro:
        "When content is ingested, a `to_tsvector` call populates the search index. PostgreSQL handles the stemming, stop-word removal, and tokenisation.",
      code: `// After inserting entries, update the source's entry count
await db.execute(sql\`
  UPDATE knowledge_sources
  SET entry_count = (
    SELECT COUNT(*) FROM knowledge_entries
    WHERE source_id = \${sourceId}
  ),
  updated_at = now()
  WHERE id = \${sourceId}
\`);

// Each entry is inserted with its search vector pre-computed:
await db.insert(knowledgeEntriesTable).values({
  sourceId,
  content: chunk,
  searchVector: sql\`to_tsvector('english', \${chunk})\`,
});`,
      lines: [
        {
          lines: "12-15",
          label: "to_tsvector at insert time",
          explanation:
            "The search vector is computed once at insert time, not at query time. This is crucial for performance — a 100,000-entry KB would be unusable if PostgreSQL had to recompute all vectors on every search. The GIN index is built on the pre-computed `searchVector` column.",
        },
        {
          lines: "2-9",
          label: "entry_count update",
          explanation:
            "`entry_count` on `knowledge_sources` is a denormalised count — it keeps the total entry count readily available for the UI without a `COUNT(*)` query every time. It's updated after each batch insert.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "How KB results enter the LLM prompt",
      paragraphs: [
        "At the start of a call, `getAttachedSourceIds` resolves which knowledge sources are attached to the agent (via the M:N join table `agent_knowledge_sources` and the legacy `knowledgeBaseId` column). These IDs are stored on the `SessionConfig`.",
        "Each time the pipeline calls the LLM, it first calls `retrieveKbChunks(lastUserMessage, sourceIds)` to fetch the top 5 matching chunks. These are injected into the system prompt under a `[KNOWLEDGE BASE]` header, right before the conversation history.",
        "The LLM is instructed: 'Use the following knowledge base entries to answer questions. Do not make up information not present here.' This grounds the model's responses in operator-provided facts rather than hallucinated plausibility.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Language-aware retrieval",
      body: [
        "PostgreSQL FTS has built-in support for multiple languages (`'english'`, `'french'`, `'german'`, etc.). SnapServe uses `'english'` as the default, but operators can configure `knowledgeLanguage` on a source to use a different dictionary. For Indian languages (Tamil, Hindi), FTS falls back to the `'simple'` dictionary — which is just whitespace tokenisation without stemming — since PostgreSQL doesn't ship Indic dictionaries. Simple tokenisation still works reasonably well for key-phrase matching.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does SnapServe use PostgreSQL FTS instead of semantic (vector) search for the knowledge base?",
          choices: [
            "PostgreSQL doesn't support pgvector",
            "Vector embeddings are patented and expensive to license",
            "FTS is sufficient for domain-specific agent queries, needs no extra infrastructure, and is already available in the existing DB",
            "FTS is always more accurate than vector search",
          ],
          correctIndex: 2,
          explanation:
            "For domain-specific, structured knowledge bases, FTS is effective and avoids the complexity of embedding models, pgvector, and managing a vector index. The same PostgreSQL instance already used for everything else handles it.",
        },
        {
          prompt: "When is the `search_vector` column populated?",
          choices: [
            "At query time, dynamically computed by ts_rank_cd",
            "At insert time, using to_tsvector",
            "By a background scheduled job that rebuilds the index nightly",
            "When the agent first receives a query for that source",
          ],
          correctIndex: 1,
          explanation:
            "The search vector is computed once at insert time (`to_tsvector('english', content)`). A GIN index is built on this column. Computing at query time would be catastrophically slow for large knowledge bases.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Knowledge bases use PostgreSQL FTS — no embeddings, no pgvector, no extra infrastructure",
        "`knowledge_sources` + `knowledge_entries` (with GIN-indexed `search_vector`) are the schema",
        "`to_tsvector` at insert time; `ts_rank_cd` + `plainto_tsquery` at query time",
        "Top 5 matching chunks are injected into the system prompt under `[KNOWLEDGE BASE]` before each LLM call",
        "Multi-tenant isolation: source IDs are resolved per-agent via the M:N join table",
      ],
    },
  ],
};
