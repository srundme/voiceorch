---
name: Query-param UI intents vs auto-redirect
description: Pattern for opening dialogs via ?param=1 in the dashboard when the target page auto-redirects (agents studio), and why mount-only initializers are not enough.
---

Signaling UI intent across navigation (e.g. sidebar "Manual Build" → open the create dialog in the agents studio) uses a `?create=1`-style query param. Three rules make it reliable:

1. **Latch in BOTH a lazy `useState` initializer AND a reactive `useSearch()` effect.** A mount-only `window.location.search` read misses the case where the target component is *already mounted* (same-route navigation only changes the query string — wouter keeps the instance). `useSearch()` from wouter is reactive to query changes; `window.location.search` is not.
2. **Gate any auto-redirect effect on the latched state.** The agents studio auto-redirects `/app/agents` → `/app/agents/:id`; that swaps route components and unmounts all local state, silently killing the dialog. The redirect effect must skip while the intent state is true (and include it in deps so the redirect resumes when the dialog closes). The lazy initializer is what makes this work at mount when react-query already has cached data: effects in the same commit close over the same render's state, so state set by an earlier effect is invisible to a later effect in that commit.
3. **Strip the param via `history.replaceState` immediately after latching**, or it re-triggers on refresh and gets carried along by other query-param writers (PageTabs preserves existing params when setting `?tab=`).

**Why:** the dead `snapserve:new-agent` CustomEvent bug — an event dispatched with no listener plus a redirect that unmounted the intended receiver left users with no way to create agents manually.

**How to apply:** any time a nav element outside a page needs to open a dialog/sheet inside a page, especially pages with auto-redirects or tabbed mounts. Also gate other auto-opening surfaces (e.g. the mobile agents sheet) on the same state so they don't stack above the dialog.
