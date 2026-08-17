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

export const Kinetic: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Line name="Joins the room" top={220} appear={0.08 * fps}>
        Joins the room.
      </Line>
      <Line name="Talks on camera" top={400} appear={0.75 * fps}>
        Talks on camera.
      </Line>
      <Line name="Presents the deck" top={580} appear={1.4 * fps}>
        Presents the deck.
      </Line>
      <Interactive.Div
        name="Room marks"
        style={{
          position: "absolute",
          left: 64,
          top: 780,
          display: "flex",
          gap: 28,
          opacity: interpolate(frame, [1.7 * fps, 2.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <Img src={staticFile("brand/meet-mono.svg")} style={{ height: 40 }} />
        <Img src={staticFile("brand/zoom-mono.svg")} style={{ height: 40 }} />
        <Img src={staticFile("brand/teams-mono.svg")} style={{ height: 40 }} />
      </Interactive.Div>
    </AbsoluteFill>
  );
};

const Line: React.FC<{
  readonly name: string;
  readonly top: number;
  readonly appear: number;
  readonly children: string;
}> = ({ name, top, appear, children }) => {
  const frame = useCurrentFrame();

  return (
    <Interactive.Div
      name={name}
      style={{
        position: "absolute",
        left: 64,
        top,
        width: 952,
        fontFamily,
        fontSize: 84,
        fontWeight: 700,
        letterSpacing: -2.4,
        lineHeight: 1.05,
        color: "#FFFFFF",
        opacity: interpolate(frame, [appear, appear + 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        translate: interpolate(
          frame,
          [appear, appear + 10],
          ["0px 36px", "0px 0px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          },
        ),
        scale: interpolate(frame, [appear, appear + 12], [0.92, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.spring({ damping: 16 }),
          output: "perceptual-scale",
        }),
      }}
    >
      {children}
    </Interactive.Div>
  );
};
