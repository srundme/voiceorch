import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { PUBLIC_OPERATION_IDS } from "./src/pages/docs/openapi/publicOps";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Strip campaigns / admin / onboarding / etc. from the OpenAPI document before
 * it is embedded in the dashboard bundle. Runtime filtering alone is not enough
 * — the full yaml was still shipping and some builds surfaced every tag.
 */
function filterPublicOpenApi(doc: Record<string, unknown>): Record<string, unknown> {
  const pathsIn = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  const pathsOut: Record<string, Record<string, unknown>> = {};

  for (const [p, item] of Object.entries(pathsIn)) {
    if (!item || typeof item !== "object") continue;
    if (p.startsWith("/admin")) continue;
    const next: Record<string, unknown> = {};
    // Keep shared parameters / servers on the path item when any method survives.
    for (const key of Object.keys(item)) {
      if (!(HTTP_METHODS as readonly string[]).includes(key)) {
        next[key] = item[key];
      }
    }
    let kept = 0;
    for (const method of HTTP_METHODS) {
      const op = item[method] as { operationId?: string } | undefined;
      if (!op) continue;
      const id = op.operationId;
      if (id && PUBLIC_OPERATION_IDS.has(id)) {
        next[method] = op;
        kept++;
      }
    }
    if (kept > 0) {
      // Drop non-method leftovers if they weren't needed — keep parameters only.
      const slim: Record<string, unknown> = {};
      if (Array.isArray(item.parameters)) slim.parameters = item.parameters;
      for (const method of HTTP_METHODS) {
        if (next[method]) slim[method] = next[method];
      }
      pathsOut[p] = slim;
    }
  }

  const keptTags = new Set<string>();
  for (const item of Object.values(pathsOut)) {
    for (const method of HTTP_METHODS) {
      const op = item[method] as { tags?: string[] } | undefined;
      op?.tags?.forEach((t) => keptTags.add(t));
    }
  }

  const tagsIn = Array.isArray(doc.tags) ? (doc.tags as { name: string }[]) : [];
  const tagsOut = tagsIn.filter((t) => keptTags.has(t.name));

  return { ...doc, paths: pathsOut, tags: tagsOut };
}

// Exposes a *public-docs-only* OpenAPI slice to `import spec from "virtual:openapi-spec"`.
function openapiSpecPlugin(): Plugin {
  const VIRTUAL_ID = "virtual:openapi-spec";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;
  const specPath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "lib",
    "api-spec",
    "openapi.yaml",
  );
  const publicOpsPath = path.resolve(
    import.meta.dirname,
    "src/pages/docs/openapi/publicOps.ts",
  );

  return {
    name: "openapi-spec",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const raw = readFileSync(specPath, "utf-8");
      const json = filterPublicOpenApi(parseYaml(raw) as Record<string, unknown>);
      return `export default ${JSON.stringify(json)};`;
    },
    configureServer(server) {
      server.watcher.add(specPath);
      server.watcher.add(publicOpsPath);
    },
    handleHotUpdate({ file, server }) {
      const resolved = path.resolve(file);
      if (resolved !== specPath && resolved !== publicOpsPath) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      }
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    openapiSpecPlugin(),
    ...(process.env.REPL_ID !== undefined
      ? [
          runtimeErrorOverlay(),
          ...(process.env.NODE_ENV !== "production"
            ? [
                await import("@replit/vite-plugin-cartographer").then((m) =>
                  m.cartographer({
                    root: path.resolve(import.meta.dirname, ".."),
                  }),
                ),
                await import("@replit/vite-plugin-dev-banner").then((m) =>
                  m.devBanner(),
                ),
              ]
            : []),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      "@workspace/brand-icons": path.resolve(import.meta.dirname, "..", "..", "lib", "brand-icons", "src", "index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
