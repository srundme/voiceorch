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

export const Chat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = "Join my 3 PM and present.";
  const chars = Math.round(
    interpolate(frame, [0.7 * fps, 3.1 * fps], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const bounce = (offset: number) =>
    interpolate((frame + offset) % 14, [0, 7, 14], [0, -16, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

  return (
    <AbsoluteFill
      style={{
        scale: interpolate(
          frame,
          [4.4 * fps, 6.2 * fps],
          [1, 1.28],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          },
        ),
        translate: interpolate(
          frame,
          [4.4 * fps, 6.2 * fps],
          ["0px 0px", "-20px 90px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          },
        ),
        opacity: interpolate(frame, [8.2 * fps, 9 * fps], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <Interactive.Div
        name="Host label"
        style={{
          position: "absolute",
          left: 64,
          top: 128,
          fontFamily,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 1.6,
          color: "#8E8E93",
          opacity: interpolate(frame, [0.2 * fps, 0.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        HOST
      </Interactive.Div>
      <Interactive.Div
        name="Host bubble"
        style={{
          position: "absolute",
          left: 64,
          top: 168,
          width: 952,
          minHeight: 160,
          paddingTop: 36,
          paddingBottom: 36,
          paddingLeft: 40,
          paddingRight: 40,
          borderRadius: 32,
          backgroundColor: "#1A1A1E",
          border: "1px solid rgba(255,255,255,0.1)",
          fontFamily,
          fontSize: 56,
          fontWeight: 700,
          letterSpacing: -1.4,
          lineHeight: 1.15,
          color: "#FFFFFF",
          opacity: interpolate(frame, [0.25 * fps, 0.55 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0.25 * fps, 0.7 * fps], [0.92, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 18 }),
            output: "perceptual-scale",
          }),
        }}
      >
        {text.slice(0, chars)}
      </Interactive.Div>

      <Interactive.Div
        name="Agent label"
        style={{
          position: "absolute",
          left: 64,
          top: 380,
          fontFamily,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 1.6,
          color: "#8E8E93",
          opacity: interpolate(frame, [2.6 * fps, 3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        SNAPSERVE
      </Interactive.Div>

      <Interactive.Div
        name="Thinking dots"
        style={{
          position: "absolute",
          left: 64,
          top: 424,
          width: 220,
          height: 96,
          borderRadius: 48,
          backgroundColor: "#1A1A1E",
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          opacity: interpolate(
            frame,
            [2.7 * fps, 3.1 * fps, 5.8 * fps, 6.2 * fps],
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
        name="Presenter orb"
        style={{
          position: "absolute",
          left: 64,
          top: 412,
          width: 120,
          height: 120,
          borderRadius: 120,
          backgroundColor: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: interpolate(frame, [5.9 * fps, 6.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [5.9 * fps, 6.8 * fps], [0.35, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 14 }),
            output: "perceptual-scale",
          }),
        }}
      >
        <Img
          src={staticFile("brand/presenter-agent.svg")}
          style={{ width: 68, height: 68 }}
        />
      </Interactive.Div>

      <Interactive.Div
        name="I'm in bubble"
        style={{
          position: "absolute",
          left: 204,
          top: 424,
          paddingTop: 28,
          paddingBottom: 28,
          paddingLeft: 36,
          paddingRight: 36,
          borderRadius: 32,
          backgroundColor: "#FFFFFF",
          color: "#111111",
          fontFamily,
          fontSize: 48,
          fontWeight: 700,
          letterSpacing: -1.2,
          opacity: interpolate(frame, [6.6 * fps, 7.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(
            frame,
            [6.6 * fps, 7.2 * fps],
            ["24px 0px", "0px 0px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
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
        width: 16,
        height: 16,
        borderRadius: 16,
        backgroundColor: "#E4E4E7",
        translate: `0px ${y}px`,
      }}
    />
  );
};
