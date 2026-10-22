import { describe, expect, it } from "vitest";
import { effectiveClientPermissions } from "./client-permissions.js";

describe("effectiveClientPermissions", () => {
  it("is null when neither the client nor the partner set anything", () => {
    expect(effectiveClientPermissions(null, null)).toBeNull();
  });

  it("uses the partner's setting for a client without its own", () => {
    expect(effectiveClientPermissions(null, { navVisibility: { flows: false, agents: false } }))
      .toEqual({ navVisibility: { flows: false, agents: false } });
  });

  it("lets the client's own values override the partner's, key by key", () => {
    expect(effectiveClientPermissions(
      { navVisibility: { agents: true }, mode: "read_only" },
      { navVisibility: { flows: false, agents: false }, mode: "full" },
    )).toEqual({ navVisibility: { flows: false, agents: true }, mode: "read_only" });
  });

  it("falls back to the partner's mode", () => {
    expect(effectiveClientPermissions({ navVisibility: {} }, { mode: "read_only" }))
      .toEqual({ mode: "read_only" });
  });
});
