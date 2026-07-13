/**
 * Consecutive-detection gate for passive streaming-STT language switches.
 * Explicit caller requests bypass the gate (immediate=true).
 */

export type SttLangSwitchGate = {
  pendingLang: string;
  pendingCount: number;
};

export function shouldSwitchSttLang(
  gate: SttLangSwitchGate,
  targetLang: string,
  streamLang: string | null,
  immediate: boolean,
): { shouldSwitch: boolean; gate: SttLangSwitchGate } {
  if (!targetLang || targetLang === streamLang) {
    return { shouldSwitch: false, gate };
  }
  if (immediate) {
    return { shouldSwitch: true, gate: { pendingLang: "", pendingCount: 0 } };
  }
  const next: SttLangSwitchGate =
    targetLang === gate.pendingLang
      ? { pendingLang: targetLang, pendingCount: gate.pendingCount + 1 }
      : { pendingLang: targetLang, pendingCount: 1 };
  return { shouldSwitch: next.pendingCount >= 2, gate: next };
}
