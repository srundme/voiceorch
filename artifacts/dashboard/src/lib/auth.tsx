/**
 * Standalone platform auth.
 *
 * The API issues an HS256 JWT and stores it in an HttpOnly cookie (`vo_session`).
 * Identity is loaded from GET /api/auth/me. A leftover localStorage JWT (or a
 * one-time #session= fragment on cross-origin OAuth) is migrated via
 * POST /api/auth/session then deleted from JS-accessible storage.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { trackCompleteRegistration } from "@/lib/meta-pixel";

const TOKEN_KEY = "voiceorch:session";
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
}

interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: SessionUser | null;
  getToken: () => Promise<string | null>;
  /** Resolves true when a session is established. */
  signIn: (token?: string) => Promise<boolean>;
  signOut: (reason?: SignOutReason) => void;
}

/**
 * Why the session ended, so the sign-in page can show a helpful message.
 * `revoked` covers both a server-side 401 (e.g. suspended/deleted account)
 * and an expired token.
 */
export type SignOutReason = "revoked";

const SIGNOUT_REASON_KEY = "voiceorch:signoutReason";

function userFromMe(data: { id?: string; sub?: string; email?: string | null; name?: string | null }): SessionUser | null {
  const id = data.id || data.sub;
  if (!id) return null;
  return { id, email: data.email ?? null, name: data.name ?? null };
}

async function fetchMe(): Promise<SessionUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) return null;
  return userFromMe(await res.json());
}

async function adoptToken(token: string): Promise<SessionUser | null> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      host: typeof window !== "undefined" ? window.location.host : undefined,
    }),
  });
  if (!res.ok) return null;
  return userFromMe(await res.json());
}

const AuthContext = createContext<AuthState | null>(null);

function isImpersonatePath(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  return path === `${basePath}/impersonate` || path.endsWith("/impersonate");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Login-as-user lands here before the exchange cookie exists. Skipping the
      // bootstrap /auth/me avoids a race that overwrites the session with null
      // after ImpersonatePage redeems the one-time code.
      if (isImpersonatePath()) {
        if (!cancelled) setIsLoaded(true);
        return;
      }

      let captured: string | null = null;
      const match = window.location.hash.match(/session=([^&]+)/);
      if (match && match[1]) {
        captured = decodeURIComponent(match[1]);
      }
      const isNewGoogleUser =
        /(?:^|[?&#])new_user=1(?:&|$)/.test(window.location.hash)
        || new URLSearchParams(window.location.search).get("new_user") === "1";

      if (captured) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search.replace(/([?&])new_user=1(&|$)/, "$1").replace(/[?&]$/, ""),
        );
        const adopted = await adoptToken(captured);
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
        if (!cancelled && adopted) {
          setUser(adopted);
          if (isNewGoogleUser) {
            void trackCompleteRegistration("Google", adopted.id);
          }
          setIsLoaded(true);
          return;
        }
      }

      try {
        const stored = localStorage.getItem(TOKEN_KEY);
        if (stored) {
          const adopted = await adoptToken(stored);
          localStorage.removeItem(TOKEN_KEY);
          if (!cancelled && adopted) {
            setUser(adopted);
            setIsLoaded(true);
            return;
          }
        }
      } catch { /* ignore */ }

      const me = await fetchMe();
      if (!cancelled) {
        setUser(me);
        if (isNewGoogleUser && me) {
          void trackCompleteRegistration("Google", me.id);
          const params = new URLSearchParams(window.location.search);
          if (params.get("new_user") === "1") {
            params.delete("new_user");
            const qs = params.toString();
            window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
          }
        }
        setIsLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    // Cookie carries the session; customFetch sends credentials: "include".
    return null;
  }, []);

  const signIn = useCallback(async (token?: string): Promise<boolean> => {
    if (token) {
      const adopted = await adoptToken(token);
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      if (adopted) {
        setUser(adopted);
        setIsLoaded(true);
        return true;
      }
      window.location.href = `${basePath}/sign-in`;
      return false;
    }
    const me = await fetchMe();
    if (me) {
      setUser(me);
      setIsLoaded(true);
      return true;
    }
    window.location.href = `${basePath}/sign-in`;
    return false;
  }, []);

  const signOut = useCallback((reason?: SignOutReason) => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    setUser(null);
    void fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    if (reason) {
      sessionStorage.setItem(SIGNOUT_REASON_KEY, reason);
      window.location.href = `${basePath}/sign-in`;
    } else {
      window.location.href = `${basePath}/`;
    }
  }, []);

  const value: AuthState = {
    isLoaded,
    isSignedIn: !!user,
    userId: user?.id ?? null,
    user,
    getToken,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Reads and clears the reason a previous session was force-signed-out (see
 * `signOut(reason)`), so the sign-in page can show a one-time explanatory
 * banner (e.g. "Your session ended because your account access changed").
 */
export function consumeSignOutReason(): SignOutReason | null {
  const value = sessionStorage.getItem(SIGNOUT_REASON_KEY);
  if (!value) return null;
  sessionStorage.removeItem(SIGNOUT_REASON_KEY);
  return value as SignOutReason;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export function SignedIn({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return !isSignedIn ? <>{children}</> : null;
}
