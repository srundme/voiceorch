import { beforeEach, describe, expect, it, vi } from "vitest";

/** Rows the mocked agents query resolves to, per test. */
let agentRows: Array<{ agentConfig: unknown }> = [];
const limit = vi.fn(async () => agentRows);

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit }),
      }),
    }),
  },
  agentsTable: { id: "id", agentConfig: "agent_config" },
}));

vi.mock("drizzle-orm", () => ({ eq: () => "eq" }));

const {
  configureMeetPresentation,
  ensureMeetPresentation,
  getMeetPresentation,
} = await import("./meet-presentation.js");

function agentWithDeck(url: string) {
  return [{ agentConfig: { meetings: { presentationUrl: url } } }];
}

describe("ensureMeetPresentation", () => {
  beforeEach(() => {
    limit.mockClear();
    agentRows = [];
  });

  it("returns existing state without touching the database", async () => {
    configureMeetPresentation("mid-live", "https://example.com/deck.pdf");
    const state = await ensureMeetPresentation("mid-live", 7);
    expect(state?.sourceUrl).toBe("https://example.com/deck.pdf");
    expect(limit).not.toHaveBeenCalled();
  });

  it("re-seeds a lost meeting from the agent's Meeting settings", async () => {
    agentRows = agentWithDeck("https://example.com/restored.pdf");
    const state = await ensureMeetPresentation("mid-lost", 7);
    expect(state?.sourceUrl).toBe("https://example.com/restored.pdf");
    expect(state?.slideIndex).toBe(1);
    expect(getMeetPresentation("mid-lost")?.sourceUrl).toBe("https://example.com/restored.pdf");
  });

  it("marks the recovered deck as presenting so slide tools keep working", async () => {
    agentRows = agentWithDeck("https://example.com/sharing.pdf");
    const state = await ensureMeetPresentation("mid-sharing", 7);
    expect(state?.presenting).toBe(true);
  });

  it("returns null when the agent has no deck configured", async () => {
    agentRows = [{ agentConfig: { meetings: {} } }];
    expect(await ensureMeetPresentation("mid-nodeck", 7)).toBeNull();
    expect(getMeetPresentation("mid-nodeck")).toBeNull();
  });

  it("rejects a non-https deck URL", async () => {
    agentRows = agentWithDeck("http://example.com/insecure.pdf");
    expect(await ensureMeetPresentation("mid-insecure", 7)).toBeNull();
  });

  it("does not re-query on every poll while the agent has no deck", async () => {
    agentRows = [{ agentConfig: {} }];
    await ensureMeetPresentation("mid-cooldown", 7);
    await ensureMeetPresentation("mid-cooldown", 7);
    await ensureMeetPresentation("mid-cooldown", 7);
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it("survives a database failure", async () => {
    limit.mockRejectedValueOnce(new Error("connection lost"));
    expect(await ensureMeetPresentation("mid-dberr", 7)).toBeNull();
  });
});
