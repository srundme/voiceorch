import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily } from "../fonts";

export const Host: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = "Who’s walking the deck?";
  const chars = Math.round(
    interpolate(frame, [1.4 * fps, 3.4 * fps], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(frame, [7.6 * fps, 8.3 * fps], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <Interactive.Div
        name="Host caption"
        style={{
          position: "absolute",
          left: 64,
          top: 64,
          width: 952,
          fontFamily,
          fontSize: 56,
          fontWeight: 700,
          letterSpacing: -1.4,
          lineHeight: 1.1,
          color: "#FFFFFF",
          opacity: interpolate(frame, [1.2 * fps, 1.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {text.slice(0, chars)}
      </Interactive.Div>
    </AbsoluteFill>
  );
};
