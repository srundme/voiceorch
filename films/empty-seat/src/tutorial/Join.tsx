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
import { Paper } from "./Paper";

export const Join: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Paper />
      <Interactive.Div
        name="Step 05"
        style={{
          position: "absolute",
          left: 80,
          top: 56,
          fontFamily,
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: "#5C6570",
          opacity: interpolate(frame, [0.08 * fps, 0.4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Step 05
      </Interactive.Div>
      <Interactive.Div
        name="Join title"
        style={{
          position: "absolute",
          left: 80,
          top: 96,
          fontFamily,
          fontSize: 64,
          fontWeight: 700,
          letterSpacing: -1.6,
          color: "#161A22",
          opacity: interpolate(frame, [0.2 * fps, 0.55 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        It takes the empty seat.
      </Interactive.Div>
      <Interactive.Div
        name="Meet grid"
        style={{
          position: "absolute",
          left: 80,
          top: 200,
          width: 1760,
          height: 760,
          backgroundColor: "#202124",
          borderRadius: 20,
          opacity: interpolate(frame, [0.5 * fps, 1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <Img
        src={staticFile("brand/person-a.svg")}
        style={{
          position: "absolute",
          left: 220,
          top: 340,
          width: 160,
          height: 160,
          opacity: interpolate(frame, [0.8 * fps, 1.2 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <Interactive.Div
        name="Tile A name"
        style={{
          position: "absolute",
          left: 220,
          top: 520,
          fontFamily,
          fontSize: 22,
          fontWeight: 600,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        Karthik
      </Interactive.Div>
      <Img
        src={staticFile("brand/person-b.svg")}
        style={{
          position: "absolute",
          left: 620,
          top: 340,
          width: 160,
          height: 160,
          opacity: interpolate(frame, [0.95 * fps, 1.35 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <Interactive.Div
        name="Tile B name"
        style={{
          position: "absolute",
          left: 620,
          top: 520,
          fontFamily,
          fontSize: 22,
          fontWeight: 600,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        Ananya
      </Interactive.Div>
      <Img
        src={staticFile("brand/empty-chair.svg")}
        style={{
          position: "absolute",
          left: 1020,
          top: 340,
          width: 160,
          height: 160,
          opacity: interpolate(
            frame,
            [1.1 * fps, 1.5 * fps, 3.2 * fps, 3.7 * fps],
            [0, 0.45, 0.45, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            },
          ),
        }}
      />
      <Interactive.Div
        name="Agent tile"
        style={{
          position: "absolute",
          left: 1040,
          top: 360,
          width: 120,
          height: 120,
          borderRadius: 999,
          backgroundColor: "#1a73e8",
          fontFamily,
          fontSize: 56,
          fontWeight: 400,
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: interpolate(frame, [3.4 * fps, 4 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [3.4 * fps, 4.3 * fps], [0.7, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 16 }),
            output: "perceptual-scale",
          }),
        }}
      >
        P
      </Interactive.Div>
      <Interactive.Div
        name="Agent tile name"
        style={{
          position: "absolute",
          left: 1040,
          top: 520,
          fontFamily,
          fontSize: 22,
          fontWeight: 600,
          color: "#FFFFFF",
          opacity: interpolate(frame, [3.6 * fps, 4.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Priya
      </Interactive.Div>
      <Img
        src={staticFile("brand/person-c.svg")}
        style={{
          position: "absolute",
          left: 1420,
          top: 340,
          width: 160,
          height: 160,
          opacity: interpolate(frame, [1.25 * fps, 1.65 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <Interactive.Div
        name="Tile C name"
        style={{
          position: "absolute",
          left: 1420,
          top: 520,
          fontFamily,
          fontSize: 22,
          fontWeight: 600,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        Host
      </Interactive.Div>
      <Interactive.Div
        name="I'm in"
        style={{
          position: "absolute",
          left: 80,
          top: 820,
          width: 1760,
          textAlign: "center",
          fontFamily,
          fontSize: 40,
          fontWeight: 600,
          color: "#FFFFFF",
          opacity: interpolate(frame, [4.4 * fps, 5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        I’m in. I’ll share the deck.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
