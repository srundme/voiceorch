import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily } from "../fonts";

export const Sit: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bounce = (offset: number) =>
    interpolate((frame + offset) % 16, [0, 8, 16], [0, -14, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="Thinking dots"
        style={{
          position: "absolute",
          left: 724,
          top: 668,
          display: "flex",
          gap: 18,
          opacity: interpolate(
            frame,
            [0, 0.25 * fps, 2.2 * fps, 2.55 * fps],
            [0, 1, 1, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        <Dot name="Dot 1" y={bounce(0)} />
        <Dot name="Dot 2" y={bounce(5)} />
        <Dot name="Dot 3" y={bounce(10)} />
      </Interactive.Div>

      <Interactive.Div
        name="I'm in rail"
        style={{
          position: "absolute",
          left: 0,
          top: 940,
          width: 1080,
          height: 140,
          backgroundColor: "#050505",
          opacity: interpolate(
            frame,
            [3.5 * fps, 3.9 * fps, 6.8 * fps, 7.3 * fps],
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
          name="I'm in"
          style={{
            position: "absolute",
            left: 80,
            top: 36,
            fontFamily,
            fontSize: 56,
            fontWeight: 700,
            letterSpacing: -1.2,
            color: "#FAFAFA",
          }}
        >
          I’m in.
        </Interactive.Div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};

const Dot: React.FC<{ readonly name: string; readonly y: number }> = ({
  name,
  y,
}) => {
  return (
    <Interactive.Div
      name={name}
      style={{
        width: 22,
        height: 22,
        borderRadius: 22,
        backgroundColor: "#E4E4E7",
        translate: `0px ${y}px`,
      }}
    />
  );
};
