/**
 * Static smoke audit for mobile responsiveness contracts.
 * Asserts key adaptive patterns exist so regressions (e.g. always-on 260px list)
 * fail CI without a full Playwright browser suite.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function src(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("mobile responsiveness smoke", () => {
  it("allows pinch zoom in the viewport meta", () => {
    const html = src("index.html");
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).not.toMatch(/maximum-scale\s*=\s*1/);
  });

  it("exposes safe-area and dvh helpers", () => {
    const css = src("src/index.css");
    expect(css).toMatch(/\.pb-safe/);
    expect(css).toMatch(/safe-area-inset-bottom/);
    expect(css).toMatch(/100dvh/);
  });

  it("layout has mobile bottom nav and touch-friendly header", () => {
    const layout = src("src/components/layout.tsx");
    expect(layout).toMatch(/MobileBottomNav/);
    expect(layout).toMatch(/pb-safe/);
    expect(layout).toMatch(/touch-target/);
  });

  it("agent builder uses a switcher sheet and single-column editor", () => {
    const builder = src("src/pages/agents/builder.tsx");
    expect(builder).toMatch(/agentsSheetOpen/);
    expect(builder).toMatch(/SheetContent side="left"/);
    expect(builder).toMatch(/AgentListPanel/);
    expect(builder).toMatch(/AgentEditorPanel/);
  });

  it("vibe history uses a sheet on mobile", () => {
    const vibe = src("src/pages/vibe/index.tsx");
    expect(vibe).toMatch(/useIsMobile/);
    expect(vibe).toMatch(/SheetContent side="left"/);
    expect(vibe).toMatch(/pb-safe/);
  });

  it("vibe studio keeps agent, connect, and test in the same page", () => {
    const vibe = src("src/pages/vibe/index.tsx");
    const nav = src("src/pages/vibe/studio-nav.tsx");
    expect(nav).toMatch(/Chat/);
    expect(nav).toMatch(/Agent/);
    expect(nav).toMatch(/Connect/);
    expect(nav).toMatch(/Test/);
    expect(vibe).toMatch(/AgentEditorPanel/);
    expect(vibe).toMatch(/VibeConnectPane/);
    expect(vibe).toMatch(/VibeTestPane/);
    expect(vibe).toMatch(/embedded/);
  });

  it("home page uses a responsive command-center layout", () => {
    const home = src("src/pages/home/index.tsx");
    expect(home).toMatch(/lg:grid-cols-2/);
    expect(home).toMatch(/Finish setup/);
    expect(home).toMatch(/Recent calls/);
  });

  it("outbound / OTP dialogs use large touch CTAs", () => {
    const outbound = src("src/components/outbound-call-dialog.tsx");
    const otp = src("src/components/destination-otp-dialog.tsx");
    expect(outbound).toMatch(/h-11 min-h-11/);
    expect(otp).toMatch(/h-11 min-h-11/);
  });

  it("calls and campaigns expose mobile card rows", () => {
    expect(src("src/pages/calls/index.tsx")).toMatch(/sm:hidden/);
    expect(src("src/pages/campaigns/index.tsx")).toMatch(/CampaignMobileCard/);
    expect(src("src/pages/campaigns/batch-wizard.tsx")).toMatch(/pb-safe/);
  });
});
