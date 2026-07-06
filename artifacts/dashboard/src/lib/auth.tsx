/**
 * Standalone platform auth (sign-in with Google).
 *
 * Replaces Clerk. The API server owns the Google OAuth app and issues a signed
 * session token (HS256 JWT). On the OAuth callback the server redirects back to
 * the dashboard with the token in the URL fragment (#session=<jwt>); we capture
 * it on load, store it in localStorage, and expose a Clerk-compatible surface
 * (useAuth / SignedIn / SignedOut) so the rest of the app keeps working.
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

interface DecodedToken {
  sub: string;
  email: string | null;
  name: string | null;
  exp: number;
}

interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: SessionUser | null;
  getToken: () => Promise<string | null>;
  signIn: (token?: string) => void;
  signOut: () => void;
}

function decode(token: string): DecodedToken | null {
  try {
    const body = token.split(".")[1];
    if (!body) return null;
    const json = JSON.parse(
      atob(body.replace(/-/g, "+").replace(/_/g, "/")),
    ) as Partial<DecodedToken>;
    if (typeof json.sub !== "string" || !json.sub) return null;
    if (typeof json.exp !== "number" || json.exp * 1000 < Date.now()) return null;
    return {
      sub: json.sub,
      email: json.email ?? null,
      name: json.name ?? null,
      exp: json.exp,
    };
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // 1) Capture a token delivered via the OAuth callback fragment (#session=...)
    let captured: string | null = null;
    const match = window.location.hash.match(/session=([^&]+)/);
    if (match && match[1]) {
      captured = decodeURIComponent(match[1]);
    }
    // Server sets `new_user=1` on the redirect ONLY when the Google callback
    // just inserted a brand-new users row (see routes/auth.ts) — an existing
    // user signing back in via Google never carries this flag.
    const isNewGoogleUser = /(?:^|[#&])new_user=1(?:&|$)/.test(window.location.hash);

    if (captured && decode(captured)) {
      localStorage.setItem(TOKEN_KEY, captured);
      // Strip the fragment so the token doesn't linger in the URL / history.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      setToken(captured);
      // This branch only runs immediately after the Google OAuth callback
      // redirect delivers a fresh token via the URL fragment — never on a
      // returning-session page reload (that's the `stored` branch below) and
      // never for email/password login (that flow calls signIn() directly,
      // not this effect). Gated on the server's new_user flag so it fires
      // only for a genuinely new account, never an existing-user login.
      if (isNewGoogleUser) {
        void trackCompleteRegistration("Google", captured);
      }
    } else {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored && decode(stored)) {
        setToken(stored);
      } else if (stored) {
        localStorage.removeItem(TOKEN_KEY);
      }
    }
    setIsLoaded(true);
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    // Always read from localStorage — stable reference (no [token] dep).
    // This prevents AuthTokenSync from clearing _authTokenGetter on each login,
    // which would cause onboarding-status fetches to fire unauthenticated.
    const t = localStorage.getItem(TOKEN_KEY);
    if (t && decode(t)) return t;
    return null;
  }, []);

  const signIn = useCallback((token?: string) => {
    if (token && decode(token)) {
      localStorage.setItem(TOKEN_KEY, token);
      setToken(token);
    } else {
      window.location.href = `${basePath}/sign-in`;
    }
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    window.location.href = `${basePath}/`;
  }, []);

  const decoded = token ? decode(token) : null;
  const value: AuthState = {
    isLoaded,
    isSignedIn: !!decoded,
    userId: decoded?.sub ?? null,
    user: decoded ? { id: decoded.sub, email: decoded.email, name: decoded.name } : null,
    getToken,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
