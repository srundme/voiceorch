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

export const World: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0D0D0E" }}>
      <Interactive.Div
        name="Meet stage"
        style={{
          position: "absolute",
          left: 40,
          top: 200,
          width: 1000,
          height: 840,
          backgroundColor: "#161618",
          borderRadius: 28,
          opacity: interpolate(frame, [0.1 * fps, 0.45 * fps, 12.4 * fps, 13.2 * fps], [0, 1, 1, 0.12], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <Tile
        name="Karthik tile"
        left={72}
        top={232}
        src="brand/person-a.svg"
        label="Karthik"
        appear={0.35 * fps}
      />
      <Tile
        name="Ananya tile"
        left={556}
        top={232}
        src="brand/person-b.svg"
        label="Ananya"
        appear={0.5 * fps}
      />
      <Tile
        name="Host tile"
        left={72}
        top={632}
        src="brand/person-c.svg"
        label="Host"
        appear={0.65 * fps}
      />
      <Interactive.Div
        name="Empty seat tile"
        style={{
          position: "absolute",
          left: 556,
          top: 632,
          width: 452,
          height: 376,
          borderRadius: 20,
          backgroundColor: "#0D0D0E",
          border: "1px solid rgba(255,255,255,0.08)",
          opacity: interpolate(frame, [0.8 * fps, 1.15 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <Img
        src={staticFile("brand/empty-chair.svg")}
        style={{
          position: "absolute",
          left: 702,
          top: 720,
          width: 160,
          height: 160,
          opacity: interpolate(
            frame,
            [0.9 * fps, 1.3 * fps, 5.4 * fps, 5.9 * fps],
            [0, 0.55, 0.55, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      />
      <Interactive.Div
        name="Empty label"
        style={{
          position: "absolute",
          left: 580,
          top: 948,
          fontFamily,
          fontSize: 22,
          fontWeight: 600,
          color: "rgba(255,255,255,0.35)",
          opacity: interpolate(
            frame,
            [1 * fps, 1.4 * fps, 5.4 * fps, 5.9 * fps],
            [0, 1, 1, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      >
        Empty
      </Interactive.Div>
    </AbsoluteFill>
  );
};

const Tile: React.FC<{
  readonly name: string;
  readonly left: number;
  readonly top: number;
  readonly src: string;
  readonly label: string;
  readonly appear: number;
}> = ({ name, left, top, src, label, appear }) => {
  const frame = useCurrentFrame();

  return (
    <Interactive.Div
      name={name}
      style={{
        position: "absolute",
        left,
        top,
        width: 452,
        height: 376,
        borderRadius: 20,
        backgroundColor: "#0D0D0E",
        border: "1px solid rgba(255,255,255,0.08)",
        opacity: interpolate(frame, [appear, appear + 10], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        scale: interpolate(frame, [appear, appear + 14], [0.94, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.spring({ damping: 18 }),
          output: "perceptual-scale",
        }),
      }}
    >
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          left: 146,
          top: 86,
          width: 160,
          height: 160,
        }}
      />
      <Interactive.Div
        name={`${name} label`}
        style={{
          position: "absolute",
          left: 24,
          top: 328,
          fontFamily,
          fontSize: 22,
          fontWeight: 600,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        {label}
      </Interactive.Div>
    </Interactive.Div>
  );
};
