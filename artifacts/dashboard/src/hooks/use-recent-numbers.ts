import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

export interface RecentNumber {
  number: string;
  dialedAt: number;
}

const MAX_ENTRIES = 5;

function storageKey(userId: string) {
  return `voiceorch:recent-numbers:${userId}`;
}

function readList(userId: string): RecentNumber[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentNumber =>
          !!e && typeof e.number === "string" && e.number.trim() !== "" && typeof e.dialedAt === "number",
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function useRecentNumbers() {
  const { userId } = useAuth();
  const [recentNumbers, setRecentNumbers] = useState<RecentNumber[]>([]);

  useEffect(() => {
    if (!userId) {
      setRecentNumbers([]);
      return;
    }
    setRecentNumbers(readList(userId));
  }, [userId]);

  const recordNumber = useCallback(
    (number: string) => {
      const trimmed = number.trim();
      if (!userId || !trimmed) return;
      const next = [
        { number: trimmed, dialedAt: Date.now() },
        ...readList(userId).filter((e) => e.number !== trimmed),
      ].slice(0, MAX_ENTRIES);
      try {
        localStorage.setItem(storageKey(userId), JSON.stringify(next));
      } catch {
        // storage unavailable — ignore
      }
      setRecentNumbers(next);
    },
    [userId],
  );

  return { recentNumbers, recordNumber };
}
