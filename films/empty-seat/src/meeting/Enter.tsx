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

export const Enter: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bounce = (offset: number) =>
    interpolate((frame + offset) % 14, [0, 7, 14], [0, -14, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(frame, [8.6 * fps, 9.2 * fps], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <Interactive.Div
        name="Thinking dots"
        style={{
          position: "absolute",
          left: 668,
          top: 760,
          width: 228,
          height: 88,
          borderRadius: 44,
          backgroundColor: "#1A1A1E",
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          opacity: interpolate(
            frame,
            [3.6 * fps, 4 * fps, 5.5 * fps, 5.9 * fps],
            [0, 1, 1, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        <Dot name="Meet dot 1" y={bounce(0)} />
        <Dot name="Meet dot 2" y={bounce(5)} />
        <Dot name="Meet dot 3" y={bounce(10)} />
      </Interactive.Div>

      <Interactive.Div
        name="Presenter orb"
        style={{
          position: "absolute",
          left: 698,
          top: 728,
          width: 168,
          height: 168,
          borderRadius: 168,
          backgroundColor: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: interpolate(frame, [5.7 * fps, 6.15 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [5.7 * fps, 6.6 * fps], [0.28, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 13 }),
            output: "perceptual-scale",
          }),
        }}
      >
        <Img
          src={staticFile("brand/presenter-agent.svg")}
          style={{ width: 88, height: 88 }}
        />
      </Interactive.Div>

      <Interactive.Div
        name="I'm in"
        style={{
          position: "absolute",
          left: 580,
          top: 936,
          fontFamily,
          fontSize: 40,
          fontWeight: 700,
          letterSpacing: -1.6,
          color: "#FFFFFF",
          opacity: interpolate(frame, [6.5 * fps, 7 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [6.5 * fps, 7.1 * fps], ["0px 28px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        I’m in.
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
        width: 14,
        height: 14,
        borderRadius: 14,
        backgroundColor: "#E4E4E7",
        translate: `0px ${y}px`,
      }}
    />
  );
};
