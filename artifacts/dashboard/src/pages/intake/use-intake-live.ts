import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeDisposition, IntakeDto, IntakeFieldKey } from "./intake-contract";

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
export type IntakeFlash = Record<string, number>;

const FLASH_MS = 2_200;

export interface UseIntakeLive {
  intake: IntakeDto | null;
  dispositions: readonly IntakeDisposition[];
  loading: boolean;
  loadError: string | null;
  connection: IntakeConnection;
  flash: IntakeFlash;
  fieldErrors: Record<string, string>;
  saving: Record<string, boolean>;
  markEditing: (key: string, editing: boolean) => void;
  writeField: (key: IntakeFieldKey, value: string | number | null) => Promise<void>;
  writeExtra: (key: string, value: string | number | null) => Promise<void>;
  complete: (englishCommunication: string | null) => Promise<void>;
}

export function useIntakeLive(token: string): UseIntakeLive {
  const [intake, setIntake] = useState<IntakeDto | null>(null);
  const [dispositions, setDispositions] = useState<readonly IntakeDisposition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connection, setConnection] = useState<IntakeConnection>("connecting");
  const [flash, setFlash] = useState<IntakeFlash>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const editingRef = useRef<Set<string>>(new Set());
  const lastFieldsRef = useRef<IntakeDto["fields"] | null>(null);
  const lastAnswersRef = useRef<IntakeDto["dispositionAnswers"] | null>(null);
  const lastDispositionRef = useRef<string | null>(null);
  const revisionRef = useRef(-1);

  const applyFrame = useCallback((incoming: IntakeDto) => {
    if (incoming.revision < revisionRef.current) return;
    revisionRef.current = incoming.revision;

    const previousFields = lastFieldsRef.current;
    const previousAnswers = lastAnswersRef.current;
    const merged = { ...incoming.fields };
    for (const key of editingRef.current) {
      if (previousFields && key in previousFields) {
        merged[key as IntakeFieldKey] = previousFields[key as IntakeFieldKey] ?? null;
      }
    }

    const mergedAnswers = { ...incoming.dispositionAnswers };
    for (const key of editingRef.current) {
      if (previousAnswers && key in previousAnswers) {
        mergedAnswers[key] = previousAnswers[key] ?? null;
      }
    }

    const changed: IntakeFlash = {};
    if (previousFields) {
      for (const key of Object.keys(merged) as IntakeFieldKey[]) {
        if (merged[key] !== previousFields[key]) changed[key] = Date.now();
      }
    }
    if (previousAnswers) {
      for (const key of Object.keys({ ...previousAnswers, ...mergedAnswers })) {
        if (mergedAnswers[key] !== previousAnswers[key]) changed[key] = Date.now();
      }
    }
    if (lastDispositionRef.current !== incoming.dispositionId) {
      changed.disposition = Date.now();
    }
    if (Object.keys(changed).length > 0) setFlash((f) => ({ ...f, ...changed }));

    lastFieldsRef.current = merged;
    lastAnswersRef.current = mergedAnswers;
    lastDispositionRef.current = incoming.dispositionId;
    setIntake({ ...incoming, fields: merged, dispositionAnswers: mergedAnswers });
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const [snapRes, schemaRes] = await Promise.all([
          fetch(`${API}/intake/${token}`, { credentials: "include" }),
          fetch(`${API}/intake/schema`, { credentials: "include" }),
        ]);
        if (!snapRes.ok) {
          const body = (await snapRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Could not load the form (${snapRes.status})`);
        }
        const dto = (await snapRes.json()) as IntakeDto;
        if (schemaRes.ok) {
          const schema = (await schemaRes.json()) as { dispositions?: IntakeDisposition[] };
          if (!cancelled && Array.isArray(schema.dispositions)) setDispositions(schema.dispositions);
        }
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
    source.onerror = () => setConnection("reconnecting");
    return () => {
      source.close();
      setConnection("closed");
    };
  }, [token, applyFrame]);

  useEffect(() => {
    if (Object.keys(flash).length === 0) return;
    const timer = setTimeout(() => {
      const cutoff = Date.now() - FLASH_MS;
      setFlash((current) => {
        const next: IntakeFlash = {};
        for (const [key, at] of Object.entries(current)) {
          if (at > cutoff) next[key] = at;
        }
        return next;
      });
    }, FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const markEditing = useCallback((key: string, editing: boolean) => {
    if (editing) editingRef.current.add(key);
    else editingRef.current.delete(key);
  }, []);

  const patchFields = useCallback(
    async (key: string, value: string | number | null, kind: "typed" | "extra") => {
      setIntake((current) => {
        if (!current) return current;
        if (kind === "typed") {
          const fields = { ...current.fields, [key]: value };
          lastFieldsRef.current = fields;
          return { ...current, fields };
        }
        if (key === "disposition") {
          lastDispositionRef.current = typeof value === "string" ? value : null;
          lastAnswersRef.current = {};
          return {
            ...current,
            dispositionId: typeof value === "string" ? value : null,
            dispositionAnswers: {},
            missingDispositionFields: [],
          };
        }
        const dispositionAnswers = { ...current.dispositionAnswers, [key]: value };
        lastAnswersRef.current = dispositionAnswers;
        return { ...current, dispositionAnswers };
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

  const writeField = useCallback(
    (key: IntakeFieldKey, value: string | number | null) => patchFields(key, value, "typed"),
    [patchFields],
  );

  const writeExtra = useCallback(
    (key: string, value: string | number | null) => patchFields(key, value, "extra"),
    [patchFields],
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
    dispositions,
    loading,
    loadError,
    connection,
    flash,
    fieldErrors,
    saving,
    markEditing,
    writeField,
    writeExtra,
    complete,
  };
}
