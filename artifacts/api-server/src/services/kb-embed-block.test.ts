/**
 * Embed circuit breaker: a permanently failing embedding provider (revoked key,
 * disabled billing, exhausted quota) must stop the retry loop, leave the KB on
 * FTS, and be reported — not spin "Indexing…" forever.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Chainable drizzle-ish stub: every builder method returns itself, awaiting it
 * resolves to [] (no managed key row → the env key is used). */
function chain(): unknown {
  const obj: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => unknown) => resolve([]),
  };
  for (const m of ["from", "where", "orderBy", "limit", "set", "returning"]) {
    obj[m] = () => obj;
  }
  return obj;
}

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: [{ ok: 1 }] })),
    select: vi.fn(() => chain()),
    update: vi.fn(() => chain()),
  },
  knowledgeEntriesTable: {},
  platformSettingsTable: { key: "key", value: "value" },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Fresh module instance per test — the breaker is module-level state. */
async function loadService() {
  vi.resetModules();
  const mod = await import("./kb-embeddings.js");
  await mod.probeKbVectorSupport();
  return mod;
}

function mockFetchStatus(status: number) {
  const fn = vi.fn(async () => new Response("Lightning dunning decision is deny for project", { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("KB embed circuit breaker", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env["JINA_API_KEY"] = "test-key";
    delete process.env["OPENAI_API_KEY"];
    delete process.env["GEMINI_API_KEY"];
    process.env["KB_EMBED_BLOCK_RETRY_MS"] = "60000";
  });

  it("opens on a billing/auth rejection and reports why", async () => {
    const { embedKbQuery, getKbEmbedBlock } = await loadService();
    mockFetchStatus(403);

    expect(await embedKbQuery("what are your prices")).toBeNull();

    expect(getKbEmbedBlock()?.reason).toMatch(/key rejected/i);
    expect(getKbEmbedBlock()?.detail).toContain("dunning");
  });

  it("stops calling the provider while open, so turns are not stalled", async () => {
    const { embedKbQuery } = await loadService();
    const fetchMock = mockFetchStatus(403);

    await embedKbQuery("first question");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await embedKbQuery("second question");
    await embedKbQuery("third question");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("half-opens after the retry window so a fixed key self-heals", async () => {
    const { embedKbQuery, getKbEmbedBlock } = await loadService();
    const fetchMock = mockFetchStatus(403);

    await embedKbQuery("first question");
    expect(getKbEmbedBlock()).not.toBeNull();

    const realNow = Date.now;
    Date.now = () => realNow() + 120_000;
    try {
      await embedKbQuery("later question");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
    }
  });

  it("treats a transient 500 as retryable rather than fatal", async () => {
    const { embedKbQuery, getKbEmbedBlock } = await loadService();
    const fetchMock = mockFetchStatus(500);

    await embedKbQuery("first question");
    await embedKbQuery("second question");

    expect(getKbEmbedBlock()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
