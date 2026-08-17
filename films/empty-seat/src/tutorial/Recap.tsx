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

export const Recap: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Paper />
      <Interactive.Div
        name="Recap kicker"
        style={{
          position: "absolute",
          left: 120,
          top: 140,
          fontFamily,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: "#5C6570",
          opacity: interpolate(frame, [0.08 * fps, 0.35 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        That’s the loop
      </Interactive.Div>
      <Interactive.Div
        name="Recap line"
        style={{
          position: "absolute",
          left: 120,
          top: 360,
          width: 1680,
          fontFamily,
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: -1.8,
          lineHeight: 1.2,
          color: "#161A22",
          opacity: interpolate(frame, [0.25 * fps, 0.7 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Call → seat → deck → WhatsApp.
      </Interactive.Div>
      <Interactive.Div
        name="Recap sub"
        style={{
          position: "absolute",
          left: 120,
          top: 560,
          width: 1400,
          fontFamily,
          fontSize: 36,
          fontWeight: 500,
          color: "#5C6570",
          opacity: interpolate(frame, [1.1 * fps, 1.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        One teammate. Not four vendors.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
