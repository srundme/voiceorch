import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily } from "../fonts";

export const Flip: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="next_slide chip"
        style={{
          position: "absolute",
          left: 64,
          top: 220,
          paddingTop: 18,
          paddingBottom: 18,
          paddingLeft: 28,
          paddingRight: 28,
          borderRadius: 20,
          backgroundColor: "#FFFFFF",
          color: "#111111",
          fontFamily,
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: 0.4,
          opacity: interpolate(frame, [0.08 * fps, 0.35 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(
            frame,
            [1.55 * fps, 1.7 * fps, 1.85 * fps],
            [1, 1.08, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              output: "perceptual-scale",
            },
          ),
        }}
      >
        next_slide
      </Interactive.Div>
      <Interactive.Div
        name="Slide 3"
        style={{
          position: "absolute",
          left: 64,
          top: 340,
          fontFamily,
          fontSize: 180,
          fontWeight: 700,
          letterSpacing: -7,
          color: "#FFFFFF",
          opacity: interpolate(
            frame,
            [0.15 * fps, 0.45 * fps, 1.6 * fps, 1.85 * fps],
            [0, 1, 1, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
          translate: interpolate(
            frame,
            [1.6 * fps, 1.85 * fps],
            ["0px 0px", "0px -90px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        3 / 12
      </Interactive.Div>
      <Interactive.Div
        name="Slide 4"
        style={{
          position: "absolute",
          left: 64,
          top: 340,
          fontFamily,
          fontSize: 180,
          fontWeight: 700,
          letterSpacing: -7,
          color: "#FFFFFF",
          opacity: interpolate(
            frame,
            [1.65 * fps, 1.95 * fps],
            [0, 1],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
          translate: interpolate(
            frame,
            [1.65 * fps, 1.95 * fps],
            ["0px 90px", "0px 0px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
        }}
      >
        4 / 12
      </Interactive.Div>
    </AbsoluteFill>
  );
};
