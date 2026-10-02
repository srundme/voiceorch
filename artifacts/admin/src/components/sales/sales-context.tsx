import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SalesUser } from "@/lib/sales-types";

type Scope = "team" | "mine";

type SalesPrefs = {
  user: SalesUser;
  isFounder: boolean;
  demo: boolean;
  setDemo: (v: boolean) => void;
  /** Founders can switch between team and own work; teammates always see their own. */
  scope: Scope;
  setScope: (v: Scope) => void;
};

const SalesPrefsContext = createContext<SalesPrefs | null>(null);

const DEMO_KEY = "sales-demo";
const SCOPE_KEY = "sales-scope";

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — keep in memory only */
  }
}

export function SalesPrefsProvider({ user, children }: { user: SalesUser; children: ReactNode }) {
  const [demo, setDemoState] = useState(() => readStored(DEMO_KEY) === "1");
  const [scopePref, setScopePref] = useState<Scope>(() => (readStored(SCOPE_KEY) === "mine" ? "mine" : "team"));
  const isFounder = user.role === "founder";

  const setDemo = useCallback((v: boolean) => {
    setDemoState(v);
    writeStored(DEMO_KEY, v ? "1" : "0");
  }, []);
  const setScope = useCallback((v: Scope) => {
    setScopePref(v);
    writeStored(SCOPE_KEY, v);
  }, []);

  const value = useMemo<SalesPrefs>(
    () => ({ user, isFounder, demo, setDemo, scope: isFounder ? scopePref : "mine", setScope }),
    [user, isFounder, demo, setDemo, scopePref, setScope],
  );
  return <SalesPrefsContext.Provider value={value}>{children}</SalesPrefsContext.Provider>;
}

export function useSalesPrefs(): SalesPrefs {
  const ctx = useContext(SalesPrefsContext);
  if (!ctx) throw new Error("useSalesPrefs must be used inside SalesPrefsProvider");
  return ctx;
}

/** Demo flag for query params; false outside the provider (login/invite pages). */
export function useDemoFlag(): boolean {
  return useContext(SalesPrefsContext)?.demo ?? false;
}
