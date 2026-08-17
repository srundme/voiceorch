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

export const End: React.FC = () => {
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
          top: 200,
          width: 200,
          height: 200,
          opacity: interpolate(frame, [0.1 * fps, 0.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />
      <Interactive.Div
        name="End wordmark"
        style={{
          position: "absolute",
          left: 160,
          top: 430,
          width: 1600,
          textAlign: "center",
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize: 84,
          letterSpacing: -2,
          color: "#161A22",
          opacity: interpolate(frame, [0.35 * fps, 0.75 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <span style={{ fontWeight: 700 }}>Snap</span>
        <span style={{ fontWeight: 400 }}>Serve</span>
      </Interactive.Div>
      <Interactive.Div
        name="End tagline"
        style={{
          position: "absolute",
          left: 160,
          top: 540,
          width: 1600,
          textAlign: "center",
          fontFamily,
          fontSize: 36,
          fontWeight: 500,
          color: "#5C6570",
          opacity: interpolate(frame, [0.65 * fps, 1.05 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        The teammate who takes the empty seat.
      </Interactive.Div>
      <Interactive.Div
        name="End URL"
        style={{
          position: "absolute",
          left: 160,
          top: 640,
          width: 1600,
          textAlign: "center",
          fontFamily,
          fontSize: 32,
          fontWeight: 600,
          color: "#161A22",
          opacity: interpolate(frame, [1.1 * fps, 1.55 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        app.snapserve.ai
      </Interactive.Div>
    </AbsoluteFill>
  );
};
