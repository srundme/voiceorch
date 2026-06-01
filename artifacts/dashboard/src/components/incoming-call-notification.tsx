/**
 * IncomingCallNotification
 * ────────────────────────────────────────────────────────────────────────────
 * Listens to GET /api/webcall-notify (SSE) for scheduled callback events.
 * When a callback fires, shows a ringing popup so the user can accept and
 * jump straight to a webcall with that agent — which already has memory of
 * the prior conversation.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { PhoneIncoming, PhoneOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CallbackEvent {
  callbackId: number;
  agentId: number;
  agentName: string;
}

const RING_TIMEOUT_MS = 60_000; // auto-dismiss after 60 s if not answered

export function IncomingCallNotification() {
  const [incoming, setIncoming]   = useState<CallbackEvent | null>(null);
  const [, navigate]              = useLocation();
  const { isSignedIn }            = useAuth();
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef                     = useRef<EventSource | null>(null);

  const dismiss = useCallback(() => {
    setIncoming(null);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const accept = useCallback((agentId: number) => {
    dismiss();
    navigate(`/agents/${agentId}?tab=test`);
  }, [dismiss, navigate]);

  useEffect(() => {
    // Don't open SSE until the user is authenticated — prevents 401 retry loops.
    if (!isSignedIn) return;

    let backoff = 2000;
    let stopped = false;

    function connect() {
      if (stopped) return;
      const es = new EventSource("/api/webcall-notify", { withCredentials: true });
      esRef.current = es;

      es.addEventListener("callback", (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data as string) as CallbackEvent;
          setIncoming(payload);
          // Auto-dismiss after timeout
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(dismiss, RING_TIMEOUT_MS);
          backoff = 2000; // reset on successful message
        } catch { /* ignore bad JSON */ }
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!stopped) {
          // Reconnect with exponential backoff (cap at 30 s)
          setTimeout(connect, Math.min(backoff, 30_000));
          backoff = Math.min(backoff * 2, 30_000);
        }
      };
    }

    connect();

    return () => {
      stopped = true;
      esRef.current?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isSignedIn, dismiss]);

  if (!incoming) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] w-80 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="rounded-2xl border border-primary/30 bg-background/95 backdrop-blur-sm shadow-2xl overflow-hidden">
        {/* Pulsing top bar */}
        <div className="h-1 w-full bg-primary animate-pulse" />

        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                Incoming Call
              </span>
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Agent info */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <PhoneIncoming className="h-4 w-4 text-primary animate-bounce" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{incoming.agentName}</p>
              <p className="text-xs text-muted-foreground">Calling back as scheduled</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 gap-1.5 h-9 text-xs"
              onClick={() => accept(incoming.agentId)}
            >
              <PhoneIncoming className="h-3.5 w-3.5" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-1.5 h-9 text-xs text-muted-foreground"
              onClick={dismiss}
            >
              <PhoneOff className="h-3.5 w-3.5" />
              Decline
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
