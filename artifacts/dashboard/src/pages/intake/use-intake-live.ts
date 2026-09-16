import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeDto, IntakeFieldKey } from "./intake-contract";

/**
 * Live view of one intake row.
 *
 * Snapshot on mount, then an SSE stream carries every agent write. A field the
 * operator is editing is held back from incoming frames — otherwise a write
 * landing mid-typing would yank the text out from under them.
 */

const API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export type IntakeConnection = "connecting" | "live" | "reconnecting" | "closed";

export interface IntakeFieldError {
  field: string;
  message: string;
}

/** Fields the agent changed recently, so the UI can highlight them. */
export type IntakeFlash = Partial<Record<IntakeFieldKey, number>>;

const FLASH_MS = 2_200;

export interface UseIntakeLive {
  intake: IntakeDto | null;
  loading: boolean;
  loadError: string | null;
  connection: IntakeConnection;
  flash: IntakeFlash;
  fieldErrors: Record<string, string>;
  saving: Partial<Record<IntakeFieldKey, boolean>>;
  markEditing: (key: IntakeFieldKey, editing: boolean) => void;
  writeField: (key: IntakeFieldKey, value: string | number | null) => Promise<void>;
  complete: (englishCommunication: string | null) => Promise<void>;
}

export function useIntakeLive(token: string): UseIntakeLive {
  const [intake, setIntake] = useState<IntakeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connection, setConnection] = useState<IntakeConnection>("connecting");
  const [flash, setFlash] = useState<IntakeFlash>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Partial<Record<IntakeFieldKey, boolean>>>({});

  const editingRef = useRef<Set<IntakeFieldKey>>(new Set());
  const lastFieldsRef = useRef<IntakeDto["fields"] | null>(null);
  const revisionRef = useRef(-1);

  /** Merge a server frame, keeping locally-edited fields and flagging changes. */
  const applyFrame = useCallback((incoming: IntakeDto) => {
    if (incoming.revision < revisionRef.current) return;
    revisionRef.current = incoming.revision;

    const previous = lastFieldsRef.current;
    const merged = { ...incoming.fields };
    for (const key of editingRef.current) {
      if (previous) merged[key] = previous[key] ?? null;
    }

    if (previous) {
      const changed: IntakeFlash = {};
      for (const key of Object.keys(merged) as IntakeFieldKey[]) {
        if (merged[key] !== previous[key]) changed[key] = Date.now();
      }
      if (Object.keys(changed).length > 0) setFlash((f) => ({ ...f, ...changed }));
    }

    lastFieldsRef.current = merged;
    setIntake({ ...incoming, fields: merged });
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const res = await fetch(`${API}/intake/${token}`, { credentials: "include" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Could not load the form (${res.status})`);
        }
        const dto = (await res.json()) as IntakeDto;
        if (cancelled) return;
        applyFrame(dto);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load the form");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, applyFrame]);

  useEffect(() => {
    if (!token) return;
    const source = new EventSource(`${API}/intake/${token}/stream`, { withCredentials: true });
    source.onopen = () => setConnection("live");
    source.onmessage = (event) => {
      try {
        applyFrame(JSON.parse(event.data) as IntakeDto);
        setConnection("live");
      } catch {
        /* ignore a malformed frame; the next one supersedes it */
      }
    };
    // EventSource retries on its own; surface the gap instead of tearing down.
    source.onerror = () => setConnection("reconnecting");
    return () => {
      source.close();
      setConnection("closed");
    };
  }, [token, applyFrame]);

  // Drop expired highlights so a field does not stay lit for the whole call.
  useEffect(() => {
    if (Object.keys(flash).length === 0) return;
    const timer = setTimeout(() => {
      const cutoff = Date.now() - FLASH_MS;
      setFlash((current) => {
        const next: IntakeFlash = {};
        for (const [key, at] of Object.entries(current)) {
          if (at > cutoff) next[key as IntakeFieldKey] = at;
        }
        return next;
      });
    }, FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const markEditing = useCallback((key: IntakeFieldKey, editing: boolean) => {
    if (editing) editingRef.current.add(key);
    else editingRef.current.delete(key);
  }, []);

  const writeField = useCallback(
    async (key: IntakeFieldKey, value: string | number | null) => {
      // Optimistic: the operator should see their own typing land immediately.
      setIntake((current) => {
        if (!current) return current;
        const fields = { ...current.fields, [key]: value };
        lastFieldsRef.current = fields;
        return { ...current, fields };
      });
      setSaving((s) => ({ ...s, [key]: true }));
      setFieldErrors((e) => {
        const { [key]: _drop, ...rest } = e;
        return rest;
      });
      try {
        const res = await fetch(`${API}/intake/${token}/fields`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ fields: { [key]: value }, source: "human" }),
        });
        const body = (await res.json().catch(() => ({}))) as
          & Partial<IntakeDto>
          & { error?: string; fieldErrors?: IntakeFieldError[] };
        if (!res.ok) {
          const detail = body.fieldErrors?.find((f) => f.field === key)?.message;
          setFieldErrors((e) => ({ ...e, [key]: detail ?? body.error ?? "Could not save" }));
          return;
        }
        const rejected = body.fieldErrors?.find((f) => f.field === key);
        if (rejected) setFieldErrors((e) => ({ ...e, [key]: rejected.message }));
        editingRef.current.delete(key);
        applyFrame(body as IntakeDto);
      } catch {
        setFieldErrors((e) => ({ ...e, [key]: "Network error — value not saved" }));
      } finally {
        setSaving((s) => ({ ...s, [key]: false }));
      }
    },
    [token, applyFrame],
  );

  const complete = useCallback(
    async (englishCommunication: string | null) => {
      const res = await fetch(`${API}/intake/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(englishCommunication ? { englishCommunication } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<IntakeDto> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not close the form");
      applyFrame(body as IntakeDto);
    },
    [token, applyFrame],
  );

  return {
    intake,
    loading,
    loadError,
    connection,
    flash,
    fieldErrors,
    saving,
    markEditing,
    writeField,
    complete,
  };
}
