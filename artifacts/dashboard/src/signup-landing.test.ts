/**
 * New signups land on Home — not Vibe, and not a Jarvis overlay.
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
  it("sends everyone to Home from AppRoot", () => {
    const app = src("src/App.tsx");
    const appRoot = app.slice(app.indexOf("function AppRoot()"));
    const body = appRoot.slice(0, appRoot.indexOf("\n}"));

    expect(body).toMatch(/Redirect to="\/app\/home"/);
    expect(body).not.toMatch(/jarvis/);
    expect(body).not.toMatch(/\/app\/vibe/);
  });

  it("finishes onboarding on Home without opening Jarvis", () => {
    const onboarding = src("src/pages/onboarding.tsx");

    expect(onboarding).toMatch(/setLocation\("\/app\/home"\)/);
    expect(onboarding).not.toMatch(/jarvis:open/);
    expect(onboarding).not.toMatch(/setLocation\("\/app\/vibe"\)/);
  });

  it("keeps Vibe reachable as an explicit choice", () => {
    expect(src("src/pages/home/index.tsx")).toMatch(/navigate\("\/app\/vibe"\)/);
    expect(src("src/components/layout.tsx")).toMatch(/navigate\("\/app\/vibe"\)/);
  });

  it("does not mount a Jarvis UI on the dashboard", () => {
    expect(src("src/components/layout.tsx")).not.toMatch(/VoiceAssistant/);
    expect(src("src/App.tsx")).not.toMatch(/VoiceAssistant/);
  });
});
