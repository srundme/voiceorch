import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Several routers apply auth to their whole surface via `router.use(requireAuth)`.
 * They are mounted without a path prefix, so Express runs that middleware for
 * every request that reaches them — not just their own routes. Any router that
 * serves unauthenticated browser hits (OAuth redirects, public booking pages)
 * must therefore be mounted earlier, or those requests get 401 JSON and never
 * reach their handler.
 */
const routesDir = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(resolve(routesDir, "index.ts"), "utf8");

function importedModulePath(identifier: string): string | null {
  const re = new RegExp(`import\\s+${identifier}\\s+from\\s+"(\\.[^"]+)"`);
  const relative = re.exec(indexSource)?.[1];
  if (!relative) return null;

  const base = resolve(routesDir, relative.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, resolve(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const mountOrder: string[] = [...indexSource.matchAll(/^router\.use\((\w+)\);$/gm)].map(
  (m) => m[1]!,
);

function appliesBlanketAuth(identifier: string): boolean {
  const modulePath = importedModulePath(identifier);
  if (!modulePath) return false;
  return /^router\.use\(\s*requireAuth/m.test(readFileSync(modulePath, "utf8"));
}

describe("routes/index.ts mount order", () => {
  const firstBlanketAuthIndex = mountOrder.findIndex(appliesBlanketAuth);

  it("has at least one blanket-auth router, so the ordering rule is meaningful", () => {
    expect(firstBlanketAuthIndex).toBeGreaterThan(-1);
  });

  // Each of these serves at least one route that an unauthenticated browser hits
  // directly: Google's OAuth redirect, a provider redirect, or a public page.
  it.each([
    ["authRouter", "/api/auth/google/callback"],
    ["meetCalendarRouter", "/api/meet-calendar/google/callback"],
    ["kycRouter", "/api/kyc/callback"],
    ["sheetsRouter", "/api/sheets/google/callback"],
    ["schedulingRouter", "/api/scheduling/google/callback"],
    ["partnerPublicRouter", "/api/public/partner-branding"],
  ])("mounts %s before any blanket-auth router so %s stays reachable", (identifier) => {
    const index = mountOrder.indexOf(identifier);
    expect(index).toBeGreaterThan(-1);
    expect(index).toBeLessThan(firstBlanketAuthIndex);
  });
});

describe("Google OAuth callback handlers", () => {
  it.each([
    ["sheets.ts", "/sheets/google/callback"],
    ["scheduling/google-oauth.ts", "/scheduling/google/callback"],
  ])("registers %s without requireAuth", (file, route) => {
    const source = readFileSync(resolve(routesDir, file), "utf8");
    const registration = new RegExp(`router\\.get\\("${route}",([^)]*)`).exec(source);
    expect(registration).not.toBeNull();
    expect(registration![1]).not.toContain("requireAuth");
  });
});
