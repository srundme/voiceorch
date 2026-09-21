/**
 * Load artifacts/api-server/.env into process.env when present.
 * File is gitignored (*.env). Never commit secrets.
 * No-op if the file is missing or Node cannot load it.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadLocalEnv(fromModuleUrl: string = import.meta.url): boolean {
  // fromModuleUrl is typically …/src/… → go up to package root (api-server/)
  let dir = dirname(fileURLToPath(fromModuleUrl));
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      try {
        // Node 20.12+ / 24: load without overriding already-set vars.
        process.loadEnvFile(candidate);
        return true;
      } catch {
        return false;
      }
    }
    dir = join(dir, "..");
  }
  return false;
}
