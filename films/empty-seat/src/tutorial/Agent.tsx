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

export const Agent: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Paper />
      <Interactive.Div
        name="Step 01"
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
        Step 01
      </Interactive.Div>
      <Interactive.Div
        name="Agent title"
        style={{
          position: "absolute",
          left: 120,
          top: 150,
          width: 780,
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
        Create an agent.
      </Interactive.Div>
      <Interactive.Div
        name="Agent body"
        style={{
          position: "absolute",
          left: 120,
          top: 340,
          width: 720,
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
        Name it. Pick a voice. Write what it should do. Turn Meetings on.
      </Interactive.Div>
      <Interactive.Div
        name="Agent card"
        style={{
          position: "absolute",
          left: 980,
          top: 220,
          width: 780,
          height: 640,
          backgroundColor: "#FFFFFF",
          border: "1px solid #E2E6EB",
          borderRadius: 24,
          opacity: interpolate(frame, [1 * fps, 1.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [1 * fps, 1.7 * fps], ["40px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Interactive.Div
          name="Agent card name"
          style={{
            position: "absolute",
            left: 40,
            top: 40,
            fontFamily,
            fontSize: 40,
            fontWeight: 700,
            color: "#161A22",
          }}
        >
          Priya
        </Interactive.Div>
        <Interactive.Div
          name="Agent card role"
          style={{
            position: "absolute",
            left: 40,
            top: 96,
            fontFamily,
            fontSize: 24,
            fontWeight: 500,
            color: "#5C6570",
          }}
        >
          Sales teammate · Tamil + English
        </Interactive.Div>
        <Interactive.Div
          name="Chip voice"
          style={{
            position: "absolute",
            left: 40,
            top: 180,
            padding: "12px 18px",
            borderRadius: 999,
            backgroundColor: "#F4F6F8",
            fontFamily,
            fontSize: 22,
            fontWeight: 600,
            color: "#161A22",
          }}
        >
          Voice · Sarvam
        </Interactive.Div>
        <Interactive.Div
          name="Chip meetings"
          style={{
            position: "absolute",
            left: 250,
            top: 180,
            padding: "12px 18px",
            borderRadius: 999,
            backgroundColor: "#161A22",
            fontFamily,
            fontSize: 22,
            fontWeight: 600,
            color: "#FFFFFF",
          }}
        >
          Meetings on
        </Interactive.Div>
        <Interactive.Div
          name="Prompt label"
          style={{
            position: "absolute",
            left: 40,
            top: 280,
            fontFamily,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: "#5C6570",
          }}
        >
          Prompt
        </Interactive.Div>
        <Interactive.Div
          name="Prompt text"
          style={{
            position: "absolute",
            left: 40,
            top: 320,
            width: 700,
            fontFamily,
            fontSize: 26,
            fontWeight: 500,
            lineHeight: 1.4,
            color: "#161A22",
          }}
        >
          Qualify the lead, book a Meet, join the room, present the deck, then send a WhatsApp recap.
        </Interactive.Div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
