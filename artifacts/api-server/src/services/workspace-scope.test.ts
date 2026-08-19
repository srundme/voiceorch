import { describe, expect, it } from "vitest";
import { collectWorkspaceUserIds, teamRoleCanWrite } from "./workspace-scope-logic.js";

describe("collectWorkspaceUserIds", () => {
  it("returns only self when there are no team rows", () => {
    expect(collectWorkspaceUserIds("owner_1", [])).toEqual(["owner_1"]);
  });

  it("lets a teammate see the owner's account", () => {
    const ids = collectWorkspaceUserIds("mate_2", [
      { ownerUserId: "owner_1", memberUserId: "mate_2", status: "active", role: "member" },
    ]);
    expect(ids.sort()).toEqual(["mate_2", "owner_1"].sort());
  });

  it("lets the owner see agents created by active teammates", () => {
    const ids = collectWorkspaceUserIds("owner_1", [
      { ownerUserId: "owner_1", memberUserId: "mate_2", status: "active", role: "member" },
      { ownerUserId: "owner_1", memberUserId: null, status: "pending", role: "member" },
    ]);
    expect(ids.sort()).toEqual(["mate_2", "owner_1"].sort());
  });

  it("ignores pending invites and other workspaces", () => {
    const ids = collectWorkspaceUserIds("mate_2", [
      { ownerUserId: "owner_1", memberUserId: "mate_2", status: "pending", role: "member" },
      { ownerUserId: "other", memberUserId: "stranger", status: "active", role: "admin" },
    ]);
    expect(ids).toEqual(["mate_2"]);
  });
});

describe("teamRoleCanWrite", () => {
  it("blocks viewers and allows everyone else", () => {
    expect(teamRoleCanWrite("viewer")).toBe(false);
    expect(teamRoleCanWrite("member")).toBe(true);
    expect(teamRoleCanWrite("admin")).toBe(true);
    expect(teamRoleCanWrite(null)).toBe(true);
  });
});
