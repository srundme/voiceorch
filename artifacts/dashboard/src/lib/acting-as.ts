import { setClientContext } from "@workspace/api-client-react";

/**
 * Partner "acting as client" mode.
 *
 * When a partner clicks "Agents" on a client row in Partner Hub, the whole
 * dashboard switches to operating on that client's account: every generated
 * API hook sends `x-client-context: <client id>` (see custom-fetch), which the
 * server validates (active partner → managed client) before swapping the
 * request's effective identity.
 *
 * State lives in sessionStorage so it survives route changes AND full page
 * reloads (the agent builder navigates to /app/agents/:id), and is scoped to
 * the tab — closing it exits the mode. The module-load bootstrap below re-arms
 * the header BEFORE the first query fires on a hard reload.
 *
 * IMPORTANT: callers must `queryClient.clear()` when entering/exiting — the
 * react-query cache does not key on the header.
 */

const KEY = "snapserve.actingAsClient";

export interface ActingAs {
  clientId: string;
  clientName: string;
}

export function loadActingAs(): ActingAs | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActingAs;
    return parsed && typeof parsed.clientId === "string" && parsed.clientId ? parsed : null;
  } catch {
    return null;
  }
}

export function startActingAs(target: ActingAs): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(target));
  } catch {
    /* private mode — header still set for this page's lifetime */
  }
  setClientContext(target.clientId);
}

export function stopActingAs(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  setClientContext(null);
}

// Bootstrap on module load (imported by Layout) so a hard reload inside
// acting-as mode re-arms the header before any query fires.
const initial = loadActingAs();
if (initial) setClientContext(initial.clientId);
