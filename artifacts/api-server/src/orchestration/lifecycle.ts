let draining = false;
export function beginDraining(): void { draining = true; }
export function isDraining(): boolean { return draining; }
export function assertAcceptingCalls(): void {
  if (draining) throw new Error("Server draining; retry on a healthy instance");
}
export function callDrainMs(raw = process.env.CALL_DRAIN_MS): number {
  const n = Number(raw ?? 300000);
  return Number.isFinite(n) ? Math.min(1800000, Math.max(0, n)) : 300000;
}
