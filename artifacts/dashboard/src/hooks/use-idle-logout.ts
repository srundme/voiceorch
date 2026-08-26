import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";

/** Signed-in dashboard users are logged out after this much UI inactivity. */
export const IDLE_LOGOUT_MS = 5 * 60 * 1000;

/** Shared across SnapServe tabs so activity in one tab keeps the session alive in all. */
const LAST_ACTIVITY_KEY = "voiceorch:lastActivityAt";
const ACTIVITY_CHANNEL = "voiceorch:idle-activity";

/** Real user interaction on the page — resets the idle clock. */
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "mousemove",
  "mousedown",
  "pointermove",
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
  "touchmove",
  "click",
  "wheel",
];

function readSharedActivityAt(): number {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeSharedActivityAt(at: number): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Auto sign-out only when the user has not moved the cursor / interacted
 * with ANY open SnapServe dashboard tab for `idleMs` (default 5 minutes).
 *
 * Activity is shared via localStorage so an idle background tab cannot clear
 * the session cookie while another tab is still being used.
 * Dashboard only — do not mount this in the admin app.
 */
export function useIdleLogout(idleMs: number = IDLE_LOGOUT_MS): void {
  const { isSignedIn, isLoaded, signOut } = useAuth();
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let throttleUntil = 0;
    let timeoutId = 0;
    let channel: BroadcastChannel | null = null;

    try {
      channel = new BroadcastChannel(ACTIVITY_CHANNEL);
    } catch {
      channel = null;
    }

    const armTimerFromShared = () => {
      window.clearTimeout(timeoutId);
      const last = readSharedActivityAt() || Date.now();
      const remaining = Math.max(1, idleMs - (Date.now() - last));
      timeoutId = window.setTimeout(() => {
        // Re-check shared activity — another tab may have been used after we armed.
        const latest = readSharedActivityAt();
        if (Date.now() - latest < idleMs) {
          armTimerFromShared();
          return;
        }
        signOutRef.current("idle");
      }, remaining);
    };

    const markActivity = () => {
      const now = Date.now();
      if (now < throttleUntil) return;
      throttleUntil = now + 500;
      writeSharedActivityAt(now);
      try {
        channel?.postMessage({ at: now });
      } catch {
        /* ignore */
      }
      armTimerFromShared();
    };

    // Seed shared clock so a fresh tab doesn't immediately inherit a stale stamp.
    writeSharedActivityAt(Date.now());
    armTimerFromShared();

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActivity, { passive: true, capture: true });
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== LAST_ACTIVITY_KEY || e.newValue == null) return;
      armTimerFromShared();
    };
    window.addEventListener("storage", onStorage);

    const onChannel = () => {
      armTimerFromShared();
    };
    channel?.addEventListener("message", onChannel);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActivity, { capture: true } as EventListenerOptions);
      }
      window.removeEventListener("storage", onStorage);
      channel?.removeEventListener("message", onChannel);
      try {
        channel?.close();
      } catch {
        /* ignore */
      }
      window.clearTimeout(timeoutId);
    };
  }, [isLoaded, isSignedIn, idleMs]);
}
