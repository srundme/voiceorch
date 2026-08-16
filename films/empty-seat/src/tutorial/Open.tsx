import {
  AbsoluteFill,
  Easing,
  Img,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily } from "../fonts";
import { Paper } from "./Paper";

export const Open: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Paper />
      <Img
        src={staticFile("brand/snapserve-mark-ink.svg")}
        style={{
          position: "absolute",
          left: 860,
          top: 220,
          width: 200,
          height: 200,
          opacity: interpolate(frame, [0.15 * fps, 0.55 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [0.15 * fps, 0.8 * fps], [0.78, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 18 }),
            output: "perceptual-scale",
          }),
        }}
      />
      <Interactive.Div
        name="Wordmark"
        style={{
          position: "absolute",
          left: 160,
          top: 450,
          width: 1600,
          textAlign: "center",
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: 92,
          letterSpacing: -2,
          color: "#161A22",
          opacity: interpolate(frame, [0.45 * fps, 0.9 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <span style={{ fontWeight: 700 }}>Snap</span>
        <span style={{ fontWeight: 400 }}>Serve</span>
      </Interactive.Div>
      <Interactive.Div
        name="Tutorial label"
        style={{
          position: "absolute",
          left: 160,
          top: 568,
          width: 1600,
          textAlign: "center",
          fontFamily,
          fontSize: 44,
          fontWeight: 500,
          color: "#5C6570",
          opacity: interpolate(frame, [0.85 * fps, 1.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        A 2-minute tutorial
      </Interactive.Div>
      <Interactive.Div
        name="Open tagline"
        style={{
          position: "absolute",
          left: 160,
          top: 640,
          width: 1600,
          textAlign: "center",
          fontFamily,
          fontSize: 36,
          fontWeight: 500,
          color: "#161A22",
          opacity: interpolate(frame, [1.4 * fps, 2 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        How the teammate takes the empty seat.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
