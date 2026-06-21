import { useEffect, useRef, useState } from "react";

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const keys = Object.keys(durations);
  const totalScenes = keys.length;
  const [currentScene, setCurrentScene] = useState(0);
  const hasStoppedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (window as any).startRecording?.();

    function scheduleNext(sceneIndex: number) {
      const key = keys[sceneIndex];
      const duration = durations[key];
      timerRef.current = setTimeout(() => {
        const isLastScene = sceneIndex === totalScenes - 1;

        if (isLastScene) {
          if (!hasStoppedRef.current) {
            hasStoppedRef.current = true;
            (window as any).stopRecording?.();
          }
          setCurrentScene(0);
          scheduleNext(0);
        } else {
          const nextScene = sceneIndex + 1;
          setCurrentScene(nextScene);
          scheduleNext(nextScene);
        }
      }, duration);
    }

    scheduleNext(0);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { currentScene };
}
