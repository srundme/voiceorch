import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily } from "../fonts";
import { Paper } from "./Paper";

export const Call: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Paper />
      <Interactive.Div
        name="Step 03"
        style={{
          position: "absolute",
          left: 120,
          top: 100,
          fontFamily,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: "#5C6570",
          opacity: interpolate(frame, [0.08 * fps, 0.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Step 03
      </Interactive.Div>
      <Interactive.Div
        name="Call title"
        style={{
          position: "absolute",
          left: 120,
          top: 150,
          fontFamily,
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: -1.8,
          color: "#161A22",
          opacity: interpolate(frame, [0.2 * fps, 0.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        It dials.
      </Interactive.Div>
      <Interactive.Div
        name="Phone card"
        style={{
          position: "absolute",
          left: 560,
          top: 280,
          width: 800,
          height: 560,
          backgroundColor: "#161A22",
          borderRadius: 32,
          opacity: interpolate(frame, [0.6 * fps, 1.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0.6 * fps, 1.3 * fps], [0.92, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 16 }),
            output: "perceptual-scale",
          }),
        }}
      >
        <Interactive.Div
          name="Live pill"
          style={{
            position: "absolute",
            left: 40,
            top: 36,
            padding: "8px 16px",
            borderRadius: 999,
            backgroundColor: "#FFFFFF",
            fontFamily,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: "#161A22",
          }}
        >
          Live
        </Interactive.Div>
        <Interactive.Div
          name="Caller name"
          style={{
            position: "absolute",
            left: 40,
            top: 160,
            fontFamily,
            fontSize: 48,
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          Karthik
        </Interactive.Div>
        <Interactive.Div
          name="Caller number"
          style={{
            position: "absolute",
            left: 40,
            top: 228,
            fontFamily,
            fontSize: 28,
            fontWeight: 500,
            color: "rgba(255,255,255,0.55)",
          }}
        >
          +91 86374 16833
        </Interactive.Div>
        <Interactive.Div
          name="Transcript"
          style={{
            position: "absolute",
            left: 40,
            top: 340,
            width: 720,
            fontFamily,
            fontSize: 30,
            fontWeight: 500,
            lineHeight: 1.4,
            color: "#FFFFFF",
            opacity: interpolate(frame, [1.6 * fps, 2.2 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          “I can walk you through the deck at 3 PM. I’ll send a Meet link.”
        </Interactive.Div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
