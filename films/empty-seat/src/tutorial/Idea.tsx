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

export const Idea: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Paper />
      <Interactive.Div
        name="Idea kicker"
        style={{
          position: "absolute",
          left: 120,
          top: 120,
          fontFamily,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: "#5C6570",
          opacity: interpolate(frame, [0.1 * fps, 0.45 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        One agent. Four rooms.
      </Interactive.Div>
      <Interactive.Div
        name="Call"
        style={{
          position: "absolute",
          left: 120,
          top: 280,
          fontFamily,
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: -2.4,
          color: "#161A22",
          opacity: interpolate(frame, [0.4 * fps, 0.85 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0.4 * fps, 0.85 * fps], ["0px 24px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Call.
      </Interactive.Div>
      <Interactive.Div
        name="Sit"
        style={{
          position: "absolute",
          left: 120,
          top: 420,
          fontFamily,
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: -2.4,
          color: "#161A22",
          opacity: interpolate(frame, [1.3 * fps, 1.75 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [1.3 * fps, 1.75 * fps], ["0px 24px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Sit in the Meet.
      </Interactive.Div>
      <Interactive.Div
        name="Present"
        style={{
          position: "absolute",
          left: 120,
          top: 560,
          fontFamily,
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: -2.4,
          color: "#161A22",
          opacity: interpolate(frame, [2.2 * fps, 2.65 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [2.2 * fps, 2.65 * fps], ["0px 24px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Present the deck.
      </Interactive.Div>
      <Interactive.Div
        name="Follow up"
        style={{
          position: "absolute",
          left: 120,
          top: 700,
          fontFamily,
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: -2.4,
          color: "#161A22",
          opacity: interpolate(frame, [3.1 * fps, 3.55 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [3.1 * fps, 3.55 * fps], ["0px 24px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Follow up on WhatsApp.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
