/**
 * In-process fan-out for live intake form updates.
 *
 * A field write notifies every SSE viewer attached to that token in the same
 * process. The SSE handler ALSO re-reads the row on a timer, so a write that
 * lands on another api-server instance still reaches the browser — this hub is
 * the fast path, the timer is the correctness floor.
 */

type Listener = (revision: number) => void;

const listeners = new Map<string, Set<Listener>>();

export function onIntakeChange(token: string, fn: Listener): () => void {
  let set = listeners.get(token);
  if (!set) {
    set = new Set<Listener>();
    listeners.set(token, set);
  }
  set.add(fn);
  return () => {
    const current = listeners.get(token);
    if (!current) return;
    current.delete(fn);
    if (current.size === 0) listeners.delete(token);
  };
}

export function emitIntakeChange(token: string, revision: number): void {
  const set = listeners.get(token);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(revision);
    } catch {
      /* a broken viewer must not fail the write */
    }
  }
}

export function intakeViewerCount(token: string): number {
  return listeners.get(token)?.size ?? 0;
}
