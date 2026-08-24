import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";

/** Signed-in dashboard users are logged out after this much UI inactivity. */
export const IDLE_LOGOUT_MS = 5 * 60 * 1000;

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "click",
  "wheel",
];

/**
 * Auto sign-out when the user has not interacted with the page for 5 minutes.
 * Dashboard only — do not mount this in the admin app.
 */
export function useIdleLogout(idleMs: number = IDLE_LOGOUT_MS): void {
  const { isSignedIn, isLoaded, signOut } = useAuth();
  const lastActivityRef = useRef(Date.now());
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    lastActivityRef.current = Date.now();
    let throttleUntil = 0;

    const markActivity = () => {
      const now = Date.now();
      if (now < throttleUntil) return;
      throttleUntil = now + 1000;
      lastActivityRef.current = now;
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActivity, { passive: true, capture: true });
    }
    document.addEventListener("visibilitychange", markActivity);

    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= idleMs) {
        signOutRef.current("idle");
      }
    }, 15_000);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActivity, { capture: true } as EventListenerOptions);
      }
      document.removeEventListener("visibilitychange", markActivity);
      window.clearInterval(timer);
    };
  }, [isLoaded, isSignedIn, idleMs]);
}
