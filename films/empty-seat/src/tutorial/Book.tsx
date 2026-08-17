import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { fontFamily } from "../fonts";
import { Paper } from "./Paper";

export const Book: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Paper />
      <Interactive.Div
        name="Step 04"
        style={{
          position: "absolute",
          left: 120,
          top: 100,
          fontFamily,
          fontSize: 28,
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
        Step 04
      </Interactive.Div>
      <Interactive.Div
        name="Book title"
        style={{
          position: "absolute",
          left: 120,
          top: 150,
          width: 900,
          fontFamily,
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: -1.8,
          lineHeight: 1.08,
          color: "#161A22",
          opacity: interpolate(frame, [0.2 * fps, 0.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        It books the Meet.
      </Interactive.Div>
      <Interactive.Div
        name="Book body"
        style={{
          position: "absolute",
          left: 120,
          top: 360,
          width: 760,
          fontFamily,
          fontSize: 36,
          fontWeight: 500,
          lineHeight: 1.35,
          color: "#5C6570",
          opacity: interpolate(frame, [0.7 * fps, 1.15 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        During the call, Priya puts a slot on the calendar. The Meet link is on the invite.
      </Interactive.Div>
      <Interactive.Div
        name="Calendar card"
        style={{
          position: "absolute",
          left: 1000,
          top: 240,
          width: 760,
          height: 600,
          backgroundColor: "#FFFFFF",
          border: "1px solid #E2E6EB",
          borderRadius: 24,
          opacity: interpolate(frame, [1 * fps, 1.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [1 * fps, 1.7 * fps], ["36px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Interactive.Div
          name="Cal month"
          style={{
            position: "absolute",
            left: 40,
            top: 36,
            fontFamily,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: "#5C6570",
          }}
        >
          Today · 3:00 PM
        </Interactive.Div>
        <Interactive.Div
          name="Cal event"
          style={{
            position: "absolute",
            left: 40,
            top: 120,
            width: 680,
            height: 200,
            backgroundColor: "#161A22",
            borderRadius: 18,
          }}
        />
        <Interactive.Div
          name="Cal event title"
          style={{
            position: "absolute",
            left: 68,
            top: 150,
            fontFamily,
            fontSize: 32,
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          Deck walkthrough
        </Interactive.Div>
        <Interactive.Div
          name="Cal event meta"
          style={{
            position: "absolute",
            left: 68,
            top: 200,
            fontFamily,
            fontSize: 22,
            fontWeight: 500,
            color: "rgba(255,255,255,0.65)",
          }}
        >
          Karthik · Google Meet · 30 min
        </Interactive.Div>
        <Interactive.Div
          name="Join flag"
          style={{
            position: "absolute",
            left: 40,
            top: 380,
            padding: "14px 20px",
            borderRadius: 12,
            backgroundColor: "#F4F6F8",
            fontFamily,
            fontSize: 24,
            fontWeight: 600,
            color: "#161A22",
            opacity: interpolate(frame, [2.2 * fps, 2.8 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Agent will join this room
        </Interactive.Div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
