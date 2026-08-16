import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily } from "../fonts";

export const Claims: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "rgba(5,5,5,0.62)",
        opacity: interpolate(frame, [0, 0.28 * fps], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <Line
        name="Joins the room"
        top={268}
        appear={0.15 * fps}
        hold={3.6 * fps}
      >
        Joins the room.
      </Line>
      <Line
        name="Talks on camera"
        top={412}
        appear={0.95 * fps}
        hold={3.6 * fps}
      >
        Talks on camera.
      </Line>
      <Line
        name="Presents the deck"
        top={556}
        appear={1.75 * fps}
        hold={3.6 * fps}
      >
        Presents the deck.
      </Line>
    </AbsoluteFill>
  );
};

const Line: React.FC<{
  readonly name: string;
  readonly top: number;
  readonly appear: number;
  readonly hold: number;
  readonly children: string;
}> = ({ name, top, appear, hold, children }) => {
  const frame = useCurrentFrame();

  return (
    <Interactive.Div
      name={name}
      style={{
        position: "absolute",
        left: 80,
        top,
        width: 920,
        fontFamily,
        fontSize: 72,
        fontWeight: 700,
        letterSpacing: -1.8,
        lineHeight: 1.05,
        color: "#FAFAFA",
        opacity: interpolate(
          frame,
          [appear, appear + 10, hold, hold + 10],
          [0, 1, 1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          },
        ),
        translate: interpolate(
          frame,
          [appear, appear + 12],
          ["-36px 0px", "0px 0px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          },
        ),
      }}
    >
      {children}
    </Interactive.Div>
  );
};
