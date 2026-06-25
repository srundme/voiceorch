import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Exposes the contract-first OpenAPI spec (lib/api-spec/openapi.yaml) to the
// dashboard as `import spec from "virtual:openapi-spec"`. Parsed at build time
// so the browser never ships a YAML parser, and kept in sync automatically via
// the dev watcher. Imported only inside the lazily-loaded API reference subtree
// so it lands in its own chunk, never the main bundle.
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

  return {
    name: "openapi-spec",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const raw = readFileSync(specPath, "utf-8");
      const json = parseYaml(raw);
      return `export default ${JSON.stringify(json)};`;
    },
    configureServer(server) {
      server.watcher.add(specPath);
    },
    handleHotUpdate({ file, server }) {
      if (path.resolve(file) !== specPath) return;
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
