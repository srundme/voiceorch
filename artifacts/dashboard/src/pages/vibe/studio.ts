export type VibeStudioTab = "chat" | "agent" | "connect" | "test";

export function parseStudioTab(search = window.location.search): VibeStudioTab {
  const s = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("studio");
  if (s === "agent" || s === "connect" || s === "test" || s === "chat") return s;
  return "chat";
}

export function writeVibeStudioUrl(opts: {
  studio: VibeStudioTab;
  refineId?: number | null;
  section?: string | null;
}) {
  const next = new URL(window.location.href);
  next.searchParams.set("studio", opts.studio);
  if (opts.refineId) next.searchParams.set("refine", String(opts.refineId));
  if (opts.studio === "agent" && opts.section) {
    next.searchParams.set("section", opts.section);
  } else if (opts.studio !== "agent") {
    next.searchParams.delete("section");
  }
  if (opts.studio !== "connect") {
    next.searchParams.delete("setup");
    next.searchParams.delete("returnTo");
    next.searchParams.delete("returnLabel");
  }
  window.history.replaceState(window.history.state, "", `${next.pathname}${next.search}${next.hash}`);
}
