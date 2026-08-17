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

export const Speak: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(frame, [0.05 * fps, 0.45 * fps, 5.4 * fps, 6 * fps], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <Interactive.Div
        name="Speak orb"
        style={{
          position: "absolute",
          left: 64,
          top: 72,
          width: 132,
          height: 132,
          borderRadius: 132,
          backgroundColor: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          scale: interpolate(frame % 16, [0, 8, 16], [1, 1.1, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
        }}
      >
        <Img
          src={staticFile("brand/presenter-agent.svg")}
          style={{ width: 72, height: 72 }}
        />
      </Interactive.Div>
      <Interactive.Div
        name="Line 1"
        style={{
          position: "absolute",
          left: 64,
          top: 260,
          width: 952,
          fontFamily,
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: -2.6,
          lineHeight: 1.02,
          color: "#FFFFFF",
          opacity: interpolate(frame, [0.35 * fps, 0.75 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0.35 * fps, 0.85 * fps], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        I’ll take it.
      </Interactive.Div>
      <Interactive.Div
        name="Line 2"
        style={{
          position: "absolute",
          left: 64,
          top: 420,
          width: 952,
          fontFamily,
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: -2.6,
          lineHeight: 1.02,
          color: "#FFFFFF",
          opacity: interpolate(frame, [1.15 * fps, 1.55 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [1.15 * fps, 1.65 * fps], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Talks in the Meet.
      </Interactive.Div>
      <Interactive.Div
        name="Line 3"
        style={{
          position: "absolute",
          left: 64,
          top: 580,
          width: 952,
          fontFamily,
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: -2.6,
          lineHeight: 1.02,
          color: "#FFFFFF",
          opacity: interpolate(frame, [1.95 * fps, 2.35 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [1.95 * fps, 2.45 * fps], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Turns the slide.
      </Interactive.Div>
      <Interactive.Div
        name="Hold line"
        style={{
          position: "absolute",
          left: 64,
          top: 780,
          width: 952,
          fontFamily,
          fontSize: 32,
          fontWeight: 500,
          color: "#8E8E93",
          opacity: interpolate(frame, [2.8 * fps, 3.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Same agent. Phone yesterday. This room now.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
