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

export const WhatsApp: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Paper />
      <Interactive.Div
        name="Step 07"
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
        Step 07
      </Interactive.Div>
      <Interactive.Div
        name="WA title"
        style={{
          position: "absolute",
          left: 120,
          top: 150,
          width: 800,
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
        It follows up.
      </Interactive.Div>
      <Interactive.Div
        name="WA body"
        style={{
          position: "absolute",
          left: 120,
          top: 360,
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
        After the room, the same agent sends the recap on WhatsApp. No second tool.
      </Interactive.Div>
      <Interactive.Div
        name="WA bubble"
        style={{
          position: "absolute",
          left: 1000,
          top: 260,
          width: 760,
          height: 560,
          backgroundColor: "#FFFFFF",
          border: "1px solid #E2E6EB",
          borderRadius: 24,
          opacity: interpolate(frame, [1 * fps, 1.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [1 * fps, 1.7 * fps], ["0px 28px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Interactive.Div
          name="WA from"
          style={{
            position: "absolute",
            left: 40,
            top: 36,
            fontFamily,
            fontSize: 22,
            fontWeight: 600,
            color: "#5C6570",
          }}
        >
          Priya · WhatsApp
        </Interactive.Div>
        <Interactive.Div
          name="WA message"
          style={{
            position: "absolute",
            left: 40,
            top: 120,
            width: 680,
            fontFamily,
            fontSize: 30,
            fontWeight: 500,
            lineHeight: 1.45,
            color: "#161A22",
          }}
        >
          Thanks for the time, Karthik. Deck is attached. Pricing is on slide 4. Reply here if you want a follow-up slot.
        </Interactive.Div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
