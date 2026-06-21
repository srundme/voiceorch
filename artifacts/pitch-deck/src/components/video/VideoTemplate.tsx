import { AnimatePresence, motion } from "framer-motion";
import { useVideoPlayer } from "@/lib/video";
import { Scene1 } from "./video_scenes/Scene1";
import { Scene2 } from "./video_scenes/Scene2";
import { Scene3 } from "./video_scenes/Scene3";
import { Scene4 } from "./video_scenes/Scene4";
import { RecordOverlay } from "./RecordOverlay";

const SCENE_DURATIONS = {
  landing: 10000,
  consent: 35000,
  dashboard: 30000,
  endcard: 15000,
};

const TOTAL_DURATION_MS =
  SCENE_DURATIONS.landing +
  SCENE_DURATIONS.consent +
  SCENE_DURATIONS.dashboard +
  SCENE_DURATIONS.endcard;

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div
      className="relative w-full h-screen overflow-hidden font-sans"
      style={{ background: "#0a0a0a", color: "#fff" }}
    >
      {/* Persistent Background radial glow */}
      <motion.div
        className="absolute top-1/2 left-1/2 w-[80vw] h-[80vw] -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, #a855f7 0%, transparent 70%)",
          opacity: 0.2,
          filter: "blur(100px)",
        }}
        animate={{ scale: [1, 1.05, 1], opacity: [0.15, 0.25, 0.15] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />

      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <Scene1 key="landing" />}
        {currentScene === 1 && <Scene2 key="consent" />}
        {currentScene === 2 && <Scene3 key="dashboard" />}
        {currentScene === 3 && <Scene4 key="endcard" />}
      </AnimatePresence>

      <RecordOverlay totalDurationMs={TOTAL_DURATION_MS} />
    </div>
  );
}
