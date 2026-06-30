// Lightweight in-app navigation tracker.
//
// wouter does not expose whether the previous history entry belongs to our SPA,
// so we count how many in-app route changes have happened since the tab loaded.
// If at least one occurred, the previous history entry is one of our own pages
// and `window.history.back()` is safe (it stays inside the app and restores the
// browser's scroll + the prior URL's query params). When zero in-app
// navigations have happened (deep link / fresh load / new tab), callers should
// fall back to an explicit parent target instead.

let inAppNavCount = 0;

export function recordInAppNavigation(): void {
  inAppNavCount += 1;
}

export function canGoBackInApp(): boolean {
  return inAppNavCount > 0;
}
