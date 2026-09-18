import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, cp, mkdir } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/orchestration/audioWorker.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      // pdfkit loads its standard-font .afm metric files from disk at runtime
      // (e.g. data/Helvetica.afm). Bundling it breaks those paths (ENOENT), so
      // it must run from node_modules like the other unbundleable packages.
      "pdfkit",
      // WhatsApp calling loads a WebRTC native addon at runtime via optional
      // dynamic import, resolving prebuilt .node binaries from sibling platform
      // packages. Bundling breaks that lookup, and bare "wrtc" is only a
      // fallback that is never installed — both must stay external so the
      // import can fail gracefully into signaling-only mode.
      "@roamhq/wrtc",
      "wrtc",
      "ffmpeg-static",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  await copyAssets(distDir);
}

// Copy static assets that esbuild won't bundle (binary/data files)
async function copyAssets(distDir) {
  const onnxSrc  = path.resolve(artifactDir, "src/orchestration/silero_vad.onnx");
  const onnxDest = path.resolve(distDir, "orchestration/silero_vad.onnx");
  await mkdir(path.dirname(onnxDest), { recursive: true });
  await cp(onnxSrc, onnxDest);
  const smartTurnSrc = path.resolve(artifactDir, "src/orchestration/smart-turn-v3.2-cpu.onnx");
  const smartTurnDest = path.resolve(distDir, "orchestration", "smart-turn-v3.2-cpu.onnx");
  await cp(smartTurnSrc, smartTurnDest);
  const fillersSrc = path.resolve(artifactDir, "src/orchestration/fillers");
  const fillersDest = path.resolve(distDir, "orchestration", "fillers");
  await cp(fillersSrc, fillersDest, { recursive: true });
  const helloSrc = path.resolve(artifactDir, "src/orchestration/adapters/live/irfan_hello_8k.pcm");
  const helloDest = path.resolve(distDir, "orchestration/adapters/live/irfan_hello_8k.pcm");
  await mkdir(path.dirname(helloDest), { recursive: true });
  await cp(helloSrc, helloDest);
}

buildAll().catch((err) => {
  console.error("BUILD FAILED:", err?.message ?? err);
  if (err && Array.isArray(err.errors) && err.errors.length > 0) {
    for (const e of err.errors) {
      const loc = e.location
        ? `${e.location.file}:${e.location.line}:${e.location.column}`
        : "unknown location";
      console.error(`esbuild error at ${loc}: ${e.text}`);
    }
  } else {
    console.error("esbuild error stack:", err?.stack ?? "(no stack)");
  }
  process.exit(1);
});
