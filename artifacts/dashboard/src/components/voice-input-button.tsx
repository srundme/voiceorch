import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
  };
}

interface SpeechRecognitionErrorEvent extends Event {
  error?: string;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
}

export function VoiceInputButton({ onTranscript, className }: VoiceInputButtonProps) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const intentRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
    return () => {
      intentRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try {
        recognitionRef.current?.abort();
      } catch {
        /* noop */
      }
    };
  }, []);

  if (!supported) return null;

  const safeStart = (rec: SpeechRecognitionInstance) => {
    try {
      rec.start();
    } catch {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (!intentRef.current) return;
        try {
          rec.start();
        } catch {
          /* give up silently */
        }
      }, 250);
    }
  };

  const start = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang =
        (typeof document !== "undefined" && document.documentElement.lang) ||
        (typeof navigator !== "undefined" && navigator.language) ||
        "en-US";
      rec.onresult = (event) => {
        let finalText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalText += result[0].transcript;
          }
        }
        if (finalText) onTranscript(finalText);
      };
      rec.onerror = (event) => {
        const err = event.error;
        if (err && FATAL_ERRORS.has(err)) {
          intentRef.current = false;
          setRecording(false);
        }
        /* benign errors (no-speech, aborted, audio-capture) — let onend auto-restart */
      };
      rec.onend = () => {
        if (intentRef.current) {
          safeStart(rec);
        } else {
          setRecording(false);
        }
      };
      recognitionRef.current = rec;
      intentRef.current = true;
      setRecording(true);
      safeStart(rec);
    } catch {
      intentRef.current = false;
      setRecording(false);
    }
  };

  const stop = () => {
    intentRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    setRecording(false);
  };

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (recording) stop();
    else start();
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={recording ? "Stop voice input" : "Start voice input"}
      aria-pressed={recording}
      className={cn(
        "absolute bottom-2 right-2 h-7 w-7 rounded-full flex items-center justify-center transition-colors",
        recording
          ? "bg-red-500 text-white animate-pulse hover:bg-red-600"
          : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700",
        className,
      )}
    >
      <Mic className="h-3.5 w-3.5" />
    </button>
  );
}
