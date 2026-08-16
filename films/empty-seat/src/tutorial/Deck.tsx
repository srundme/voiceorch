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

export const Deck: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flipped = frame > 5.2 * fps;

  return (
    <AbsoluteFill>
      <Paper />
      <Interactive.Div
        name="Step 06"
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
        Step 06
      </Interactive.Div>
      <Interactive.Div
        name="Deck title"
        style={{
          position: "absolute",
          left: 120,
          top: 150,
          fontFamily,
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: -1.8,
          color: "#161A22",
          opacity: interpolate(frame, [0.2 * fps, 0.6 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        It presents.
      </Interactive.Div>
      <Interactive.Div
        name="Slide stage"
        style={{
          position: "absolute",
          left: 120,
          top: 280,
          width: 1120,
          height: 640,
          backgroundColor: "#161A22",
          borderRadius: 20,
          opacity: interpolate(frame, [0.6 * fps, 1.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <Interactive.Div
          name="Slide heading"
          style={{
            position: "absolute",
            left: 64,
            top: 80,
            fontFamily,
            fontSize: 48,
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          {flipped ? "04  ·  Pricing" : "03  ·  The product"}
        </Interactive.Div>
        <Interactive.Div
          name="Slide body"
          style={{
            position: "absolute",
            left: 64,
            top: 180,
            width: 960,
            fontFamily,
            fontSize: 32,
            fontWeight: 500,
            lineHeight: 1.4,
            color: "rgba(255,255,255,0.72)",
          }}
        >
          {flipped
            ? "₹5 a minute on our cloud. License if it runs in your VPC."
            : "Same agent on the phone, in the Meet, and on WhatsApp."}
        </Interactive.Div>
      </Interactive.Div>
      <Interactive.Div
        name="next_slide chip"
        style={{
          position: "absolute",
          left: 1320,
          top: 420,
          width: 460,
          height: 220,
          backgroundColor: "#FFFFFF",
          border: "1px solid #E2E6EB",
          borderRadius: 20,
          opacity: interpolate(frame, [1.4 * fps, 1.9 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          rotate: interpolate(
            frame,
            [4.8 * fps, 5.4 * fps],
            ["0deg", "180deg"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
        }}
      >
        <Interactive.Div
          name="Chip label"
          style={{
            position: "absolute",
            left: 36,
            top: 40,
            fontFamily,
            fontSize: 22,
            fontWeight: 600,
            color: "#5C6570",
            rotate: interpolate(
              frame,
              [4.8 * fps, 5.4 * fps],
              ["0deg", "-180deg"],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              },
            ),
          }}
        >
          next_slide
        </Interactive.Div>
        <Interactive.Div
          name="Chip count"
          style={{
            position: "absolute",
            left: 36,
            top: 100,
            fontFamily,
            fontSize: 56,
            fontWeight: 700,
            color: "#161A22",
            rotate: interpolate(
              frame,
              [4.8 * fps, 5.4 * fps],
              ["0deg", "-180deg"],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              },
            ),
          }}
        >
          {flipped ? "4 / 12" : "3 / 12"}
        </Interactive.Div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
