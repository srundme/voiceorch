import { useEffect, useRef, useState, type ReactNode } from "react";
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

export interface VoiceInputState {
  recording: boolean;
  finalText: string;
  interimText: string;
}

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
  onStateChange?: (state: VoiceInputState) => void;
  children?: (state: VoiceInputState) => ReactNode;
}

function joinTranscript(prev: string, addition: string): string {
  if (!addition) return prev;
  if (!prev) return addition;
  const sep = /\s$/.test(prev) || /^\s/.test(addition) ? "" : " ";
  return prev + sep + addition;
}

export function VoiceInputButton({ onTranscript, className, onStateChange, children }: VoiceInputButtonProps) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [finalText, setFinalText] = useState("");
  const finalTranscriptRef = useRef("");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const intentRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onStateChangeRef.current?.({ recording, finalText, interimText });
  }, [recording, finalText, interimText]);

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

  const commitAndReset = () => {
    const text = finalTranscriptRef.current.trim();
    finalTranscriptRef.current = "";
    setFinalText("");
    setInterimText("");
    if (text) {
      try {
        onTranscriptRef.current(text);
      } catch {
        /* noop */
      }
    }
  };

  const start = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang =
        (typeof document !== "undefined" && document.documentElement.lang) ||
        (typeof navigator !== "undefined" && navigator.language) ||
        "en-US";
      rec.onresult = (event) => {
        let newFinal = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript;
          if (result.isFinal) {
            newFinal += transcript;
          } else {
            interim += transcript;
          }
        }
        if (newFinal) {
          finalTranscriptRef.current = joinTranscript(finalTranscriptRef.current, newFinal);
          setFinalText(finalTranscriptRef.current);
        }
        setInterimText(interim);
      };
      rec.onerror = (event) => {
        const err = event.error;
        if (err && FATAL_ERRORS.has(err)) {
          intentRef.current = false;
          try {
            rec.abort();
          } catch {
            /* noop */
          }
          setRecording(false);
          commitAndReset();
        }
        /* benign errors (no-speech, aborted, audio-capture) — let onend auto-restart */
      };
      rec.onend = () => {
        if (intentRef.current) {
          setInterimText("");
          safeStart(rec);
        } else {
          setRecording(false);
          commitAndReset();
        }
      };
      recognitionRef.current = rec;
      intentRef.current = true;
      finalTranscriptRef.current = "";
      setFinalText("");
      setInterimText("");
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
    /* commit happens in onend; if onend doesn't fire promptly, still flush */
    setRecording(false);
  };

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (recording) stop();
    else start();
  };

  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-label={recording ? "Stop voice input" : "Start voice input"}
      aria-pressed={recording}
      className={cn(
        "absolute bottom-2 right-2 h-7 w-7 rounded-full flex items-center justify-center transition-colors",
        recording
          ? "bg-foreground text-white animate-pulse hover:bg-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Mic className="h-3.5 w-3.5" />
    </button>
  );

  if (children) {
    return (
      <>
        {children({ recording, finalText, interimText })}
        {button}
      </>
    );
  }

  return button;
}
