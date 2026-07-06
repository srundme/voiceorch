/**
 * Meta (Facebook) Pixel — mirrors the pixel already installed on the marketing
 * site (snapserve.ai) inside the app (app.snapserve.ai) so ad conversions
 * (sign-ups) can be attributed end-to-end.
 *
 * - initMetaPixel(): loads the pixel script (if not already present), inits
 *   it with the shared Pixel ID, and fires a PageView.
 * - trackGoogleCompleteRegistration(): fires CompleteRegistration{method:"Google"}
 *   exactly once per successful Google sign-in. Only called from the
 *   OAuth-callback token-capture branch in auth.tsx — never on login failure,
 *   never on a returning session reload, never for email/password login.
 *
 * Deliberately avoids augmenting the global `Window` interface (that ran into
 * TS control-flow-narrowing edge cases with other `declare global` blocks in
 * this app) — instead uses a small typed accessor over `window as unknown`.
 */

const META_PIXEL_ID = "985387470976266";
const FIRED_KEY_PREFIX = "voiceorch:fbq_cr_fired:";

interface Fbq {
  (...args: unknown[]): void;
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  callMethod?: (...args: unknown[]) => void;
  push?: unknown;
}

interface FbqWindow {
  fbq?: Fbq;
  _fbq?: Fbq;
}

function getFbqWindow(): FbqWindow | undefined {
  if (typeof window === "undefined") return undefined;
  return window as unknown as FbqWindow;
}

function getFbq(): Fbq | undefined {
  return getFbqWindow()?.fbq;
}

let scriptLoadPromise: Promise<void> | null = null;

/** Injects the standard Meta Pixel base snippet if `fbq` isn't present yet. */
function loadPixelScript(): Promise<void> {
  const w = getFbqWindow();
  if (!w) return Promise.resolve();
  if (w.fbq) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve) => {
    (function (f: FbqWindow, b: Document, e: string, v: string) {
      if (f.fbq) return;
      const n: Fbq = ((...args: unknown[]) => {
        if (n.callMethod) n.callMethod.apply(n, args);
        else n.queue?.push(args);
      }) as Fbq;
      f.fbq = n;
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      const t = b.createElement(e) as HTMLScriptElement;
      t.async = true;
      t.src = v;
      t.onload = () => resolve();
      // Fail open — a blocked/failed pixel load must never break the app.
      t.onerror = () => resolve();
      const s = b.getElementsByTagName(e)[0];
      if (s?.parentNode) s.parentNode.insertBefore(t, s);
      else b.head.appendChild(t);
    })(w, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  });

  return scriptLoadPromise;
}

let initialized = false;

/** Call once at app startup. Idempotent. */
export async function initMetaPixel(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await loadPixelScript();
  const fbq = getFbq();
  fbq?.("init", META_PIXEL_ID);
  fbq?.("track", "PageView");
}

/** Ensures fbq is loaded + initialized before an event is sent (defense in depth —
 *  covers the case where an event fires before/without initMetaPixel having run). */
async function ensureFbqReady(): Promise<void> {
  if (getFbq()) return;
  await loadPixelScript();
  getFbq()?.("init", META_PIXEL_ID);
}

/**
 * Fires CompleteRegistration{method:"Google"} once per distinct login token.
 * `loginKey` should be the freshly-issued session token (or any value unique
 * to this specific sign-in) — using it (not a static flag) means a later,
 * genuinely new Google sign-in in the same browser tab still fires the event,
 * while re-renders/StrictMode double-invocation for the SAME sign-in don't.
 */
export async function trackGoogleCompleteRegistration(loginKey: string): Promise<void> {
  if (typeof window === "undefined" || !loginKey) return;
  const dedupeKey = FIRED_KEY_PREFIX + loginKey.slice(-32);
  try {
    if (sessionStorage.getItem(dedupeKey) === "1") return;
    sessionStorage.setItem(dedupeKey, "1");
  } catch {
    // sessionStorage unavailable (privacy mode, etc.) — proceed without dedupe
    // rather than silently dropping the event.
  }
  await ensureFbqReady();
  getFbq()?.("track", "CompleteRegistration", { method: "Google" });
}
