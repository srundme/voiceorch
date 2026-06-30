import { useEffect, useRef } from "react";

// Best-effort scroll-position restoration for an inner scroll container.
//
// wouter remounts page components on navigation, so the browser's native scroll
// restoration (which only covers the window) does not help for the dashboard's
// inner `overflow-auto` panels. This hook persists the container's scrollTop to
// sessionStorage (keyed per list) on scroll, and restores it once the list's
// content is ready (so scrollHeight is large enough for the offset to apply).
//
// Usage:
//   const scrollRef = useScrollRestoration<HTMLDivElement>("calls-list", !isLoading);
//   <div ref={scrollRef} className="overflow-auto">…</div>
export function useScrollRestoration<T extends HTMLElement>(
  key: string,
  ready: boolean,
) {
  const ref = useRef<T | null>(null);
  const restored = useRef(false);
  const storageKey = `scroll:${key}`;

  // Persist scrollTop as the user scrolls.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      try {
        sessionStorage.setItem(storageKey, String(el.scrollTop));
      } catch {
        /* storage may be unavailable (private mode / quota) — ignore */
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [storageKey]);

  // Restore once, after content is ready.
  useEffect(() => {
    if (!ready || restored.current) return;
    const el = ref.current;
    if (!el) return;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(storageKey);
    } catch {
      saved = null;
    }
    restored.current = true;
    if (saved == null) return;
    const top = parseInt(saved, 10);
    if (Number.isNaN(top)) return;
    requestAnimationFrame(() => {
      if (ref.current) ref.current.scrollTop = top;
    });
  }, [storageKey, ready]);

  return ref;
}
