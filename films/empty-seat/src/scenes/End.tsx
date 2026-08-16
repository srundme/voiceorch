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

export const End: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#050505" }}>
      <Img
        src={staticFile("brand/snapserve-mark-end.svg")}
        style={{
          position: "absolute",
          left: 430,
          top: 268,
          width: 220,
          height: 220,
          opacity: interpolate(frame, [0.12 * fps, 0.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [0.12 * fps, 0.7 * fps], [0.78, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 18 }),
            output: "perceptual-scale",
          }),
        }}
      />
      <Interactive.Div
        name="SnapServe"
        style={{
          position: "absolute",
          left: 80,
          top: 520,
          width: 920,
          textAlign: "center",
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: 72,
          letterSpacing: -1.4,
          color: "#FFFFFF",
          opacity: interpolate(frame, [0.4 * fps, 0.75 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <span style={{ fontWeight: 700 }}>Snap</span>
        <span style={{ fontWeight: 400 }}>Serve</span>
      </Interactive.Div>
      <Interactive.Div
        name="Tagline"
        style={{
          position: "absolute",
          left: 80,
          top: 620,
          width: 920,
          textAlign: "center",
          fontFamily,
          fontSize: 32,
          fontWeight: 500,
          color: "#A1A1AA",
          opacity: interpolate(frame, [0.65 * fps, 1.05 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        The teammate who takes the empty seat.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
