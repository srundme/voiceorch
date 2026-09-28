import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";
import { toE164 } from "./src/phone";

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function dialPlugin(mode: string): Plugin {
  return {
    name: "jobshop-dial",
    configureServer(server) {
      const env = { ...loadEnv(mode, server.config.root, ""), ...process.env };
      const base = (env.IRFAN_ORCH_URL || "http://127.0.0.1:8790").replace(/\/$/, "");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (env.IRFAN_DIAL_TOKEN) headers["X-Irfan-Dial"] = env.IRFAN_DIAL_TOKEN;

      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path === "/api/screen" && req.method === "GET") {
          try {
            const upstream = await fetch(`${base}/screen`, { headers });
            const data = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
            if (!upstream.ok) {
              send(res, upstream.status, { error: "The screen is not available." });
              return;
            }
            send(res, 200, data ?? {});
          } catch {
            send(res, 503, { error: "Sruthi's line is not running." });
          }
          return;
        }
        if (path === "/api/desk" && (req.method === "GET" || req.method === "POST")) {
          try {
            const upstream = await fetch(`${base}/desk`, {
              method: req.method,
              headers,
              body: req.method === "POST" ? await readBody(req, 120_000) : undefined,
            });
            const data = (await upstream.json().catch(() => null)) as { error?: string } | null;
            if (!upstream.ok) {
              send(res, upstream.status, { error: data?.error || "The line did not take this change." });
              return;
            }
            send(res, 200, (data ?? {}) as Record<string, unknown>);
          } catch {
            send(res, 503, { error: "Sruthi's line is not running." });
          }
          return;
        }
        if (path !== "/api/dial" || req.method !== "POST") {
          next();
          return;
        }
        let payload: { name?: unknown; phone?: unknown };
        try {
          payload = JSON.parse(await readBody(req, 4000)) as { name?: unknown; phone?: unknown };
        } catch {
          send(res, 400, { error: "Name and phone are required." });
          return;
        }
        const name = typeof payload.name === "string" ? payload.name.trim() : "";
        const phone = typeof payload.phone === "string" ? toE164(payload.phone) : null;
        if (!name || !phone) {
          send(res, 400, { error: "Enter a name and a mobile number." });
          return;
        }
        try {
          const upstream = await fetch(`${base}/call`, {
            method: "POST",
            headers,
            body: JSON.stringify({ name, phone }),
          });
          const data = (await upstream.json().catch(() => null)) as { error?: string; id?: string; status?: string } | null;
          if (!upstream.ok) {
            send(res, upstream.status, { error: data?.error || "The call was not placed." });
            return;
          }
          send(res, 201, { id: data?.id ?? null, status: data?.status ?? "ringing", toNumber: phone });
        } catch {
          send(res, 503, { error: "Irfan's line is not running." });
        }
      });
    },
  };
}
