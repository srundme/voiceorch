/**
 * Docs health check: nav ↔ routes, internal /docs links, production HTTP smoke.
 * Run: node scripts/check-docs.mjs
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, "artifacts/dashboard/src/pages/docs");
const NAV_FILE = join(DOCS_DIR, "docs-nav.ts");
const INDEX_FILE = join(DOCS_DIR, "index.tsx");
const PUBLIC_OPS = join(DOCS_DIR, "openapi/publicOps.ts");
const OPENAPI = join(ROOT, "lib/api-spec/openapi.yaml");
const BASE = "https://app.snapserve.ai";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

function extractNavSlugs(src) {
  const slugs = [];
  const re = /slug:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) slugs.push(m[1]);
  return [...new Set(slugs)];
}

function extractSwitchCases(src) {
  const cases = [];
  const re = /case\s+"([^"]+)":/g;
  let m;
  while ((m = re.exec(src))) cases.push(m[1]);
  return [...new Set(cases)];
}

function extractLegacyRedirects(src) {
  const map = {};
  const block = src.match(/LEGACY_REDIRECTS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) return map;
  const re = /"([^"]+)":\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(block[1]))) map[m[1]] = m[2];
  return map;
}

function extractDocsHrefs(src) {
  const hrefs = [];
  const re = /(?:href|to)=["'`](\/docs[^"'`]*)["'`]/g;
  let m;
  while ((m = re.exec(src))) hrefs.push(m[1]);
  // also template literals rare — skip
  return hrefs;
}

function parsePath(href) {
  const [path, hash] = href.split("#");
  const clean = path.replace(/\/$/, "") || "/docs";
  return { path: clean, hash: hash || null, href };
}

function slugFromPath(path) {
  if (path === "/docs" || path === "/docs/") return "introduction";
  if (path === "/docs/api-reference" || path.startsWith("/docs/api-reference/")) {
    return "api-reference";
  }
  const m = path.match(/^\/docs\/([^/?#]+)/);
  return m ? m[1] : null;
}

function extractPublicOps(src) {
  const ids = [];
  const block = src.match(/PUBLIC_OPERATION_IDS\s*=\s*new Set<string>\(\[([\s\S]*?)\]\)/);
  if (!block) return ids;
  const re = /"([a-zA-Z0-9_]+)"/g;
  let m;
  while ((m = re.exec(block[1]))) ids.push(m[1]);
  return ids;
}

function extractOpenApiOps(yaml) {
  const ids = new Set();
  const re = /operationId:\s*([a-zA-Z0-9_]+)/g;
  let m;
  while ((m = re.exec(yaml))) ids.add(m[1]);
  return ids;
}

const failures = [];
const warnings = [];

const navSrc = readFileSync(NAV_FILE, "utf8");
const indexSrc = readFileSync(INDEX_FILE, "utf8");
const navSlugs = extractNavSlugs(navSrc);
const switchCases = extractSwitchCases(indexSrc);
const legacy = extractLegacyRedirects(indexSrc);

console.log(`Nav slugs: ${navSlugs.length}`);
console.log(`Switch cases: ${switchCases.length}`);

for (const slug of navSlugs) {
  if (slug === "api-reference") continue; // routed separately
  if (!switchCases.includes(slug)) {
    failures.push(`NAV_ORPHAN: slug "${slug}" in docs-nav but not in index.tsx switch`);
  }
}

for (const c of switchCases) {
  if (!navSlugs.includes(c) && !Object.values(legacy).includes(c)) {
    warnings.push(`SWITCH_EXTRA: case "${c}" not in DOCS_NAV (ok if intentional)`);
  }
}

const files = walk(DOCS_DIR);
const linkIssues = [];
const allHrefs = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const href of extractDocsHrefs(src)) {
    allHrefs.push({ href, file: relative(ROOT, file) });
  }
}

const knownSlugs = new Set([...navSlugs, ...Object.keys(legacy), ...Object.values(legacy)]);
for (const { href, file } of allHrefs) {
  const { path } = parsePath(href);
  // skip template-ish
  if (path.includes("{") || path.includes("${")) continue;
  const slug = slugFromPath(path);
  if (!slug) {
    linkIssues.push({ href, file, reason: "unparseable" });
    continue;
  }
  if (slug === "api-reference") continue;
  const resolved = legacy[slug] || slug;
  if (!knownSlugs.has(resolved) && !switchCases.includes(resolved)) {
    linkIssues.push({ href, file, reason: `unknown slug "${resolved}"` });
  }
}

if (linkIssues.length) {
  for (const i of linkIssues) {
    failures.push(`DEAD_LINK: ${i.href} in ${i.file} (${i.reason})`);
  }
} else {
  console.log(`Internal /docs links OK (${allHrefs.length} hrefs scanned)`);
}

// OpenAPI ops
try {
  const opsSrc = readFileSync(PUBLIC_OPS, "utf8");
  const yaml = readFileSync(OPENAPI, "utf8");
  const publicIds = extractPublicOps(opsSrc);
  const openIds = extractOpenApiOps(yaml);
  let missing = 0;
  for (const id of publicIds) {
    if (!openIds.has(id)) {
      failures.push(`OPENAPI_MISSING: publicOps "${id}" not in openapi.yaml`);
      missing++;
    }
  }
  console.log(`Public API ops: ${publicIds.length}, missing in OpenAPI: ${missing}`);
} catch (e) {
  warnings.push(`OpenAPI check skipped: ${e.message}`);
}

// Production smoke
const paths = [
  "/docs",
  ...navSlugs.map((s) => (s === "introduction" ? "/docs" : s === "api-reference" ? "/docs/api-reference" : `/docs/${s}`)),
];
const uniquePaths = [...new Set(paths)];

console.log(`\nSmoking ${uniquePaths.length} production URLs…`);
const smokeFails = [];
for (const p of uniquePaths) {
  const url = BASE + p;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "SnapServe-DocsCheck/1.0" },
    });
    const ok = res.status >= 200 && res.status < 400;
    const ct = res.headers.get("content-type") || "";
    if (!ok) {
      smokeFails.push(`${p} → HTTP ${res.status}`);
      failures.push(`PROD_${res.status}: ${p}`);
    } else if (!ct.includes("text/html") && !ct.includes("javascript") && !ct.includes("text/plain")) {
      warnings.push(`PROD_CT: ${p} content-type=${ct}`);
    } else {
      process.stdout.write(".");
    }
  } catch (e) {
    smokeFails.push(`${p} → ${e.message}`);
    failures.push(`PROD_ERR: ${p} ${e.message}`);
  }
}
console.log("");

console.log("\n=== DOCS TEST REPORT ===");
console.log(`Failures: ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
console.log(`Warnings: ${warnings.length}`);
for (const w of warnings.slice(0, 20)) console.log("  WARN:", w);
if (warnings.length > 20) console.log(`  … +${warnings.length - 20} more`);

if (failures.length) {
  process.exitCode = 1;
} else {
  console.log("\nRESULT: All checked documentation routes and links are working.");
}
