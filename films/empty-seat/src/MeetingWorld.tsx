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
import { fontFamily } from "./fonts";

export const MeetingWorld: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      name="Meeting world"
      style={{
        backgroundColor: "#050505",
        opacity: interpolate(frame, [20 * fps, 21 * fps], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        scale: interpolate(
          frame,
          [0, 4.8 * fps, 10 * fps, 16 * fps],
          [1, 1, 1.16, 1.06],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          },
        ),
        translate: interpolate(
          frame,
          [0, 4.8 * fps, 10 * fps, 16 * fps],
          ["0px 0px", "0px 0px", "-48px 28px", "-16px 10px"],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          },
        ),
      }}
    >
      <Interactive.Div
        name="Chrome"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1080,
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 28,
          paddingRight: 28,
          backgroundColor: "#0A0A0A",
          fontFamily,
          color: "#A1A1AA",
          fontSize: 22,
          fontWeight: 500,
        }}
      >
        Weekly standup
      </Interactive.Div>
      <Interactive.Div
        name="Rooms"
        style={{
          position: "absolute",
          right: 28,
          top: 14,
          display: "flex",
          gap: 12,
          opacity: interpolate(
            frame,
            [10.2 * fps, 11 * fps, 19.4 * fps, 20 * fps],
            [0, 1, 1, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
        }}
      >
        <Img src={staticFile("brand/meet-mono.svg")} style={{ height: 26 }} />
        <Img src={staticFile("brand/zoom-mono.svg")} style={{ height: 26 }} />
        <Img src={staticFile("brand/teams-mono.svg")} style={{ height: 26 }} />
      </Interactive.Div>

      <Tile
        name="Priya"
        left={16}
        top={64}
        src="brand/person-a.svg"
        appear={0.35 * fps}
      />
      <Tile
        name="Arjun"
        left={544}
        top={64}
        src="brand/person-b.svg"
        appear={0.5 * fps}
      />
      <Tile
        name="Maya"
        left={16}
        top={502}
        src="brand/person-c.svg"
        appear={0.65 * fps}
      />
      <EmptyTile />
    </AbsoluteFill>
  );
};

const Tile: React.FC<{
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly src: string;
  readonly appear: number;
}> = ({ name, left, top, src, appear }) => {
  const frame = useCurrentFrame();

  return (
    <Interactive.Div
      name={`${name} tile`}
      style={{
        position: "absolute",
        left,
        top,
        width: 520,
        height: 430,
        borderRadius: 24,
        backgroundColor: "#18181B",
        overflow: "hidden",
        opacity: interpolate(frame, [appear, appear + 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        scale: interpolate(frame, [appear, appear + 14], [0.94, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.spring({ damping: 200 }),
          output: "perceptual-scale",
        }),
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          left: 130,
          top: 48,
          width: 260,
          height: 260,
        }}
      />
      <Interactive.Div
        name={`${name} label`}
        style={{
          position: "absolute",
          left: 24,
          bottom: 22,
          fontFamily,
          fontSize: 28,
          fontWeight: 600,
          color: "#E4E4E7",
        }}
      >
        {name}
      </Interactive.Div>
    </Interactive.Div>
  );
};

const EmptyTile: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <Interactive.Div
      name="Empty seat tile"
      style={{
        position: "absolute",
        left: 544,
        top: 502,
        width: 520,
        height: 430,
        borderRadius: 24,
        backgroundColor: "#111113",
        border: "1px solid rgba(255,255,255,0.08)",
        overflow: "hidden",
        opacity: interpolate(frame, [0.8 * fps, 1.2 * fps], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <Img
        src={staticFile("brand/empty-chair.svg")}
        style={{
          position: "absolute",
          left: 150,
          top: 68,
          width: 220,
          height: 220,
          opacity: interpolate(frame, [6.6 * fps, 7.2 * fps], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <Interactive.Div
        name="Presenter orb"
        style={{
          position: "absolute",
          left: 150,
          top: 66,
          width: 220,
          height: 220,
          borderRadius: 220,
          backgroundColor: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: interpolate(frame, [6.9 * fps, 7.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [6.9 * fps, 7.7 * fps], [0.42, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 16 }),
            output: "perceptual-scale",
          }),
        }}
      >
        <Img
          src={staticFile("brand/presenter-agent.svg")}
          style={{ width: 124, height: 124 }}
        />
      </Interactive.Div>
      <Interactive.Div
        name="Empty label"
        style={{
          position: "absolute",
          left: 24,
          bottom: 22,
          fontFamily,
          fontSize: 28,
          fontWeight: 600,
          color: "#71717A",
          opacity: interpolate(frame, [6.6 * fps, 7.1 * fps], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
          Empty
      </Interactive.Div>
      <Interactive.Div
        name="Presenter label"
        style={{
          position: "absolute",
          left: 24,
          bottom: 22,
          fontFamily,
          fontSize: 28,
          fontWeight: 600,
          color: "#E4E4E7",
          opacity: interpolate(frame, [7.2 * fps, 7.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Presenter
      </Interactive.Div>
    </Interactive.Div>
  );
};
