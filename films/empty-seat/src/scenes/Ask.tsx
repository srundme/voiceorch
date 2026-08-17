import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily } from "../fonts";

export const Ask: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = "Who’s presenting?";
  const chars = Math.round(
    interpolate(frame, [1.1 * fps, 3.2 * fps], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="Ask rail"
        style={{
          position: "absolute",
          left: 0,
          top: 940,
          width: 1080,
          height: 140,
          backgroundColor: "#050505",
          opacity: interpolate(
            frame,
            [0.8 * fps, 1.1 * fps, 7.6 * fps, 8.2 * fps],
            [0, 1, 1, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
        }}
      >
        <Interactive.Div
          name="Ask line"
          style={{
            position: "absolute",
            left: 80,
            top: 36,
            width: 920,
            fontFamily,
            fontSize: 56,
            fontWeight: 700,
            letterSpacing: -1.2,
            color: "#FAFAFA",
          }}
        >
          {text.slice(0, chars)}
        </Interactive.Div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
