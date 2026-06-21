import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Phase = "idle" | "recording" | "done" | "error";

interface Props {
  totalDurationMs: number;
}

export function RecordOverlay({ totalDurationMs }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  async function startCapture() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      } as MediaStreamConstraints);

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";

      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setPhase("done");
        cancelAnimationFrame(rafRef.current);
      };

      recorder.start(200);
      setPhase("recording");
      startTimeRef.current = performance.now();

      const tick = () => {
        const elapsed = performance.now() - startTimeRef.current;
        const pct = Math.min(elapsed / totalDurationMs, 1);
        setProgress(pct);
        if (pct < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          recorder.stop();
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error(err);
      setPhase("error");
    }
  }

  function stopEarly() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }

  const ext = blobUrl?.includes("webm") ? "webm" : "mp4";

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-3"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.4 }}
      >
        {phase === "idle" && (
          <motion.div className="flex flex-col items-center gap-2">
            <p className="text-white/50 text-[11px] uppercase tracking-widest">
              OAuth Demo Video
            </p>
            <button
              onClick={startCapture}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-semibold"
              style={{
                background: "linear-gradient(135deg, #a855f7, #7c3aed)",
                boxShadow: "0 0 20px rgba(168,85,247,0.4)",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#fff",
                  display: "inline-block",
                }}
              />
              Record as video
            </button>
            <p className="text-white/30 text-[10px] text-center max-w-[240px]">
              Share your browser tab when prompted, then the video plays &amp; saves
              automatically
            </p>
          </motion.div>
        )}

        {phase === "recording" && (
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-48 rounded-full overflow-hidden"
              style={{ height: 4, background: "rgba(255,255,255,0.1)" }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: "linear-gradient(90deg, #a855f7, #c084fc)",
                  width: `${progress * 100}%`,
                }}
              />
            </div>
            <p className="text-white/50 text-[11px]">
              Recording… {Math.round(progress * 100)}%
            </p>
            <button
              onClick={stopEarly}
              className="text-white/30 text-[10px] underline underline-offset-2"
            >
              Stop early
            </button>
          </div>
        )}

        {phase === "done" && blobUrl && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-[#22c55e] text-sm font-semibold">
              Recording complete
            </p>
            <a
              href={blobUrl}
              download={`snapserve-oauth-demo.${ext}`}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-white text-sm font-semibold"
              style={{
                background: "linear-gradient(135deg, #22c55e, #16a34a)",
                boxShadow: "0 0 20px rgba(34,197,94,0.3)",
              }}
            >
              Download MP4
            </a>
            <button
              onClick={() => {
                setBlobUrl(null);
                setPhase("idle");
              }}
              className="text-white/30 text-[10px] underline underline-offset-2"
            >
              Record again
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-red-400 text-sm">
              Screen capture unavailable — use a screen recorder
            </p>
            <button
              onClick={() => setPhase("idle")}
              className="text-white/30 text-[10px] underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
