/**
 * New signups must land in the agent builder, not Vibe.
 *
 * Vibe Build used to be the forced first screen after onboarding and for any
 * account with zero agents. It is now opt-in ("Build with AI"), so these
 * static assertions keep the two redirect sites from drifting back.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function src(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("signup landing route", () => {
  it("sends agent-less accounts to the builder from AppRoot", () => {
    const app = src("src/App.tsx");
    const appRoot = app.slice(app.indexOf("function AppRoot()"));
    const body = appRoot.slice(0, appRoot.indexOf("\n}"));

    expect(body).toMatch(/!list\.length/);
    expect(body).toMatch(/Redirect to="\/app\/agents"/);
    expect(body).not.toMatch(/\/app\/vibe/);
  });

  it("finishes onboarding in the builder with the create dialog open", () => {
    const onboarding = src("src/pages/onboarding.tsx");

    expect(onboarding).toMatch(/setLocation\("\/app\/agents\?create=1"\)/);
    // The only remaining "vibe" reference is the stashed welcome name, which
    // Vibe consumes if the user later opens it of their own accord.
    expect(onboarding).not.toMatch(/setLocation\("\/app\/vibe"\)/);
  });

  it("keeps Vibe reachable as an explicit choice", () => {
    expect(src("src/pages/home/index.tsx")).toMatch(/navigate\("\/app\/vibe"\)/);
    expect(src("src/components/layout.tsx")).toMatch(/navigate\("\/app\/vibe"\)/);
  });
});
