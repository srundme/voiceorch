import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily } from "../fonts";

export const Present: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="Present rail"
        style={{
          position: "absolute",
          left: 0,
          top: 940,
          width: 1080,
          height: 140,
          backgroundColor: "#050505",
          opacity: interpolate(
            frame,
            [0.08 * fps, 0.32 * fps, 5.2 * fps, 5.6 * fps],
            [0, 1, 1, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        <Interactive.Div
          name="next_slide chip"
          style={{
            position: "absolute",
            left: 80,
            top: 42,
            paddingLeft: 22,
            paddingRight: 22,
            paddingTop: 12,
            paddingBottom: 12,
            borderRadius: 16,
            backgroundColor: "#FFFFFF",
            color: "#111111",
            fontFamily,
            fontSize: 26,
            fontWeight: 700,
            scale: interpolate(
              frame,
              [3.1 * fps, 3.25 * fps, 3.4 * fps],
              [1, 1.06, 1],
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
            right: 80,
            top: 32,
            fontFamily,
            fontSize: 56,
            fontWeight: 700,
            letterSpacing: -1.4,
            color: "#FAFAFA",
            opacity: interpolate(frame, [3.15 * fps, 3.4 * fps], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(
              frame,
              [3.15 * fps, 3.4 * fps],
              ["0px 0px", "0px -36px"],
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
            right: 80,
            top: 32,
            fontFamily,
            fontSize: 56,
            fontWeight: 700,
            letterSpacing: -1.4,
            color: "#FAFAFA",
            opacity: interpolate(frame, [3.2 * fps, 3.45 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(
              frame,
              [3.2 * fps, 3.45 * fps],
              ["0px 36px", "0px 0px"],
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
      </Interactive.Div>
    </AbsoluteFill>
  );
};
