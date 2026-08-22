/**
 * New signups land on Home with Jarvis open — not the Vibe page.
 *
 * Jarvis runs the same Vibe Build engine in the HUD. These static assertions
 * keep the two redirect sites from dumping people onto /app/vibe.
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
  it("sends agent-less accounts to Home with Jarvis from AppRoot", () => {
    const app = src("src/App.tsx");
    const appRoot = app.slice(app.indexOf("function AppRoot()"));
    const body = appRoot.slice(0, appRoot.indexOf("\n}"));

    expect(body).toMatch(/!list\.length/);
    expect(body).toMatch(/Redirect to="\/app\/home\?jarvis=1"/);
    expect(body).not.toMatch(/\/app\/vibe/);
  });

  it("finishes onboarding on Home with Jarvis open", () => {
    const onboarding = src("src/pages/onboarding.tsx");

    expect(onboarding).toMatch(/setLocation\("\/app\/home\?jarvis=1"\)/);
    expect(onboarding).toMatch(/jarvis:open/);
    expect(onboarding).not.toMatch(/setLocation\("\/app\/vibe"\)/);
  });

  it("keeps Vibe reachable as an explicit choice", () => {
    expect(src("src/pages/home/index.tsx")).toMatch(/navigate\("\/app\/vibe"\)/);
    expect(src("src/components/layout.tsx")).toMatch(/navigate\("\/app\/vibe"\)/);
  });

  it("runs official Vibe from the Jarvis HUD", () => {
    const hud = src("src/components/VoiceAssistant.tsx");
    const engine = src("../api-server/src/routes/vibe.ts");
    expect(hud).toMatch(/persona: "jarvis"/);
    expect(hud).toMatch(/\/api\/agents\/vibe-chat/);
    expect(engine).toMatch(/persona === "jarvis"/);
    expect(engine).toMatch(/JARVIS_VIBE_PREFIX/);
  });
});
