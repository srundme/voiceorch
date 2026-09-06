import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import router from "./admin-team-guides.js";

describe("admin team guides", () => {
  let server: Server;
  let origin: string;
  const previousAdminToken = process.env["ADMIN_TOKEN"];

  beforeAll(async () => {
    process.env["ADMIN_TOKEN"] = "test-admin-token";
    const app = express();
    app.use(router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
        origin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (previousAdminToken === undefined) delete process.env["ADMIN_TOKEN"];
    else process.env["ADMIN_TOKEN"] = previousAdminToken;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("does not expose the guide list without an admin token", async () => {
    const response = await fetch(`${origin}/admin/team-guides`);
    expect(response.status).toBe(403);
  });

  it("downloads only whitelisted PDFs for an authenticated admin", async () => {
    const response = await fetch(`${origin}/admin/team-guides/team-qa-prep.pdf`, {
      headers: { "X-Admin-Token": "test-admin-token" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("SnapServe-Team-QA-Prep.pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
  });

  it("rejects unknown filenames instead of reading arbitrary files", async () => {
    const response = await fetch(`${origin}/admin/team-guides/../../package.json.pdf`, {
      headers: { "X-Admin-Token": "test-admin-token" },
    });
    expect(response.status).toBe(404);
  });
});
