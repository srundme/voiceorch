import type { Snapshot } from "./model";

/**
 * The only file a client host replaces.
 * This package keeps the desk in the browser for the proof of concept.
 * A client build implements JobshopPort against their own call store
 * and passes it to JobshopApp.
 */
export interface JobshopPort {
  read(): Snapshot | null;
  write(snapshot: Snapshot): void;
}

const KEY = "jobshop-ai-poc-v1";

export const browserPort: JobshopPort = {
  read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw) as Snapshot;
    } catch {
      return null;
    }
  },
  write(snapshot) {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  },
};
