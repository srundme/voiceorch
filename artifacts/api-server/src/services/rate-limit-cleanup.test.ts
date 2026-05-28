import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

/**
 * Hoisted mock state.
 * `selectRows` — rows returned by the default SELECT mock.
 * `deletedKeys` — keys accumulated across each test's delete calls.
 */
const mockState = vi.hoisted(() => ({
  selectRows: [] as Array<{ key: string; value: string }>,
  deletedKeys: [] as string[][],
}));

vi.mock("drizzle-orm", () => ({
  like: vi.fn((_col: unknown, _pattern: string) => _pattern),
  inArray: vi.fn((_col: unknown, keys: string[]) => keys),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    delete: vi.fn(),
  },
  platformSettingsTable: { key: "key", value: "value" },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { db } from "@workspace/db";
import {
  __pruneTransientRows,
  __resetRegistry,
  __getRegistry,
  registerTransientKey,
} from "./rate-limit-cleanup.js";

const WINDOW_MS = 60_000;
const PREFIX = "test_prefix:";

// Capture the registry snapshot immediately at module load time (before any
// beforeEach can reset it).  A file-level beforeAll runs before any
// beforeEach, so this faithfully reflects the state after import.
let registryAtModuleLoad: ReturnType<typeof __getRegistry>;
beforeAll(() => {
  registryAtModuleLoad = __getRegistry();
});

function makeRow(key: string, timestamps: number[]): { key: string; value: string } {
  return { key, value: JSON.stringify(timestamps) };
}

function makeSelectMock(rows: Array<{ key: string; value: string }>) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  } as unknown as ReturnType<typeof db.select>;
}

function makeDeleteMock(onDelete: (keys: string[]) => void) {
  return {
    where: vi.fn((keys: string[]) => {
      onDelete(keys);
      return Promise.resolve({});
    }),
  } as unknown as ReturnType<typeof db.delete>;
}

function setupDefaultDbMocks(): void {
  vi.mocked(db.select).mockReset();
  vi.mocked(db.delete).mockReset();

  vi.mocked(db.select).mockImplementation(() =>
    makeSelectMock(mockState.selectRows),
  );

  vi.mocked(db.delete).mockImplementation(() =>
    makeDeleteMock((keys) => mockState.deletedKeys.push(keys)),
  );
}

beforeEach(() => {
  mockState.selectRows = [];
  mockState.deletedKeys = [];
  __resetRegistry([{ prefix: PREFIX, windowMs: WINDOW_MS }]);
  setupDefaultDbMocks();
});

describe("pruneTransientRows — stale rows are deleted", () => {
  it("deletes a row whose timestamps are all older than windowMs", async () => {
    const staleTs = Date.now() - WINDOW_MS - 1_000;
    mockState.selectRows = [makeRow(`${PREFIX}user1`, [staleTs])];

    await __pruneTransientRows();

    expect(mockState.deletedKeys).toHaveLength(1);
    expect(mockState.deletedKeys[0]).toContain(`${PREFIX}user1`);
  });

  it("deletes a row when every timestamp in the array is outside the window", async () => {
    const now = Date.now();
    mockState.selectRows = [
      makeRow(`${PREFIX}user2`, [now - WINDOW_MS - 5_000, now - WINDOW_MS - 10_000]),
    ];

    await __pruneTransientRows();

    expect(mockState.deletedKeys[0]).toContain(`${PREFIX}user2`);
  });

  it("deletes a row whose value is an empty timestamps array", async () => {
    mockState.selectRows = [makeRow(`${PREFIX}empty`, [])];

    await __pruneTransientRows();

    expect(mockState.deletedKeys[0]).toContain(`${PREFIX}empty`);
  });
});

describe("pruneTransientRows — active rows are kept", () => {
  it("keeps a row that has at least one timestamp within windowMs", async () => {
    mockState.selectRows = [makeRow(`${PREFIX}active`, [Date.now() - WINDOW_MS / 2])];

    await __pruneTransientRows();

    expect(mockState.deletedKeys).toHaveLength(0);
  });

  it("keeps a row with mixed timestamps when at least one is still active", async () => {
    const now = Date.now();
    mockState.selectRows = [
      makeRow(`${PREFIX}mixed`, [now - WINDOW_MS - 5_000, now - WINDOW_MS / 4]),
    ];

    await __pruneTransientRows();

    expect(mockState.deletedKeys).toHaveLength(0);
  });

  it("does not call delete at all when no stale rows are found", async () => {
    mockState.selectRows = [makeRow(`${PREFIX}fresh`, [Date.now() - 1_000])];

    await __pruneTransientRows();

    expect(vi.mocked(db.delete)).not.toHaveBeenCalled();
  });
});

describe("pruneTransientRows — unparseable JSON rows are deleted", () => {
  it("deletes a row whose value is not valid JSON", async () => {
    mockState.selectRows = [{ key: `${PREFIX}bad`, value: "not-json{{{" }];

    await __pruneTransientRows();

    expect(mockState.deletedKeys[0]).toContain(`${PREFIX}bad`);
  });

  it("deletes a row whose value is valid JSON but not an array", async () => {
    mockState.selectRows = [{ key: `${PREFIX}obj`, value: '{"foo":"bar"}' }];

    await __pruneTransientRows();

    expect(mockState.deletedKeys[0]).toContain(`${PREFIX}obj`);
  });

  it("deletes unparseable rows and keeps valid active rows in the same sweep", async () => {
    const activeTs = Date.now() - 1_000;
    mockState.selectRows = [
      { key: `${PREFIX}bad`, value: "INVALID" },
      makeRow(`${PREFIX}good`, [activeTs]),
    ];

    await __pruneTransientRows();

    expect(mockState.deletedKeys).toHaveLength(1);
    expect(mockState.deletedKeys[0]).toContain(`${PREFIX}bad`);
    expect(mockState.deletedKeys[0]).not.toContain(`${PREFIX}good`);
  });
});

describe("pruneTransientRows — a failure in one prefix does not block others", () => {
  it("continues to the next prefix when SELECT for one prefix throws", async () => {
    const SECOND_PREFIX = "second_prefix:";
    __resetRegistry([
      { prefix: PREFIX, windowMs: WINDOW_MS },
      { prefix: SECOND_PREFIX, windowMs: WINDOW_MS },
    ]);

    const stale = Date.now() - WINDOW_MS - 1_000;
    let callCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error("DB exploded on first prefix");
      return makeSelectMock([makeRow(`${SECOND_PREFIX}user`, [stale])]);
    });

    await __pruneTransientRows();

    expect(mockState.deletedKeys).toHaveLength(1);
    expect(mockState.deletedKeys[0]).toContain(`${SECOND_PREFIX}user`);
  });

  it("processes later prefixes even when an earlier DELETE throws", async () => {
    const SECOND_PREFIX = "second_prefix:";
    __resetRegistry([
      { prefix: PREFIX, windowMs: WINDOW_MS },
      { prefix: SECOND_PREFIX, windowMs: WINDOW_MS },
    ]);

    const stale = Date.now() - WINDOW_MS - 1_000;
    let selectCallCount = 0;

    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount++;
      const prefix = selectCallCount === 1 ? PREFIX : SECOND_PREFIX;
      return makeSelectMock([makeRow(`${prefix}user`, [stale])]);
    });

    let deleteCallCount = 0;
    vi.mocked(db.delete).mockImplementation(() => {
      deleteCallCount++;
      if (deleteCallCount === 1) {
        return {
          where: vi.fn(() => Promise.reject(new Error("delete failed for first prefix"))),
        } as unknown as ReturnType<typeof db.delete>;
      }
      return makeDeleteMock((keys) => mockState.deletedKeys.push(keys));
    });

    await __pruneTransientRows();

    expect(mockState.deletedKeys).toHaveLength(1);
    expect(mockState.deletedKeys[0]).toContain(`${SECOND_PREFIX}user`);
  });
});

describe("pruneTransientRows — empty registry", () => {
  it("does not call db.select when the registry is empty", async () => {
    __resetRegistry([]);

    await __pruneTransientRows();

    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });
});

describe("pruneTransientRows — no rows returned for a prefix", () => {
  it("skips the delete step entirely when SELECT returns no rows", async () => {
    mockState.selectRows = [];

    await __pruneTransientRows();

    expect(vi.mocked(db.delete)).not.toHaveBeenCalled();
  });
});

describe("registerTransientKey — built-in entry is pre-registered at module load", () => {
  it("includes the built-in test_notif_rate_limit: prefix after module load", () => {
    expect(
      registryAtModuleLoad.some((e) => e.prefix === "test_notif_rate_limit:"),
    ).toBe(true);
  });
});

describe("registerTransientKey — accumulates entries rather than replacing them", () => {
  it("appends a second entry to the registry without removing the first", () => {
    __resetRegistry([]);

    registerTransientKey({ prefix: "first_prefix:", windowMs: 10_000 });
    registerTransientKey({ prefix: "second_prefix:", windowMs: 20_000 });

    const registry = __getRegistry();
    expect(registry).toHaveLength(2);
    expect(registry[0]).toEqual({ prefix: "first_prefix:", windowMs: 10_000 });
    expect(registry[1]).toEqual({ prefix: "second_prefix:", windowMs: 20_000 });
  });
});
