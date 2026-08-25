import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";

/** Signed-in dashboard users are logged out after this much UI inactivity. */
export const IDLE_LOGOUT_MS = 5 * 60 * 1000;

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

/**
 * Auto sign-out only when the user has not moved the cursor / interacted
 * with the dashboard for `idleMs` (default 5 minutes).
 * Any mouse/pointer/keyboard/touch/scroll activity resets the timer.
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

    const armTimer = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        signOutRef.current("idle");
      }, idleMs);
    };

    const markActivity = () => {
      const now = Date.now();
      if (now < throttleUntil) return;
      throttleUntil = now + 500;
      armTimer();
    };

    armTimer();

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActivity, { passive: true, capture: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActivity, { capture: true } as EventListenerOptions);
      }
      window.clearTimeout(timeoutId);
    };
  }, [isLoaded, isSignedIn, idleMs]);
}
