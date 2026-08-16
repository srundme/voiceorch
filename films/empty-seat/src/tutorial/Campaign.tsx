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

export const Campaign: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Paper />
      <Interactive.Div
        name="Step 02"
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
        Step 02
      </Interactive.Div>
      <Interactive.Div
        name="Campaign title"
        style={{
          position: "absolute",
          left: 120,
          top: 150,
          width: 1680,
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
        Start a campaign.
      </Interactive.Div>
      <Interactive.Div
        name="Campaign body"
        style={{
          position: "absolute",
          left: 120,
          top: 260,
          width: 1400,
          fontFamily,
          fontSize: 36,
          fontWeight: 500,
          color: "#5C6570",
          opacity: interpolate(frame, [0.55 * fps, 1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Leads come from Meta, your website, Sheets, a CSV, or Zoho. Attach Priya. Dial.
      </Interactive.Div>
      <Interactive.Div
        name="Chip Meta"
        style={{
          position: "absolute",
          left: 120,
          top: 480,
          height: 88,
          padding: "0 32px",
          borderRadius: 16,
          border: "1px solid #E2E6EB",
          backgroundColor: "#FFFFFF",
          fontFamily,
          fontSize: 32,
          fontWeight: 600,
          color: "#161A22",
          display: "flex",
          alignItems: "center",
          opacity: interpolate(frame, [1.1 * fps, 1.45 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Meta
      </Interactive.Div>
      <Interactive.Div
        name="Chip Website"
        style={{
          position: "absolute",
          left: 320,
          top: 480,
          height: 88,
          padding: "0 32px",
          borderRadius: 16,
          border: "1px solid #E2E6EB",
          backgroundColor: "#FFFFFF",
          fontFamily,
          fontSize: 32,
          fontWeight: 600,
          color: "#161A22",
          display: "flex",
          alignItems: "center",
          opacity: interpolate(frame, [1.35 * fps, 1.7 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Website
      </Interactive.Div>
      <Interactive.Div
        name="Chip Sheets"
        style={{
          position: "absolute",
          left: 580,
          top: 480,
          height: 88,
          padding: "0 32px",
          borderRadius: 16,
          border: "1px solid #E2E6EB",
          backgroundColor: "#FFFFFF",
          fontFamily,
          fontSize: 32,
          fontWeight: 600,
          color: "#161A22",
          display: "flex",
          alignItems: "center",
          opacity: interpolate(frame, [1.6 * fps, 1.95 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Sheets
      </Interactive.Div>
      <Interactive.Div
        name="Chip CSV"
        style={{
          position: "absolute",
          left: 820,
          top: 480,
          height: 88,
          padding: "0 32px",
          borderRadius: 16,
          border: "2px solid #161A22",
          backgroundColor: "#161A22",
          fontFamily,
          fontSize: 32,
          fontWeight: 600,
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          opacity: interpolate(frame, [1.85 * fps, 2.2 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [2.2 * fps, 2.7 * fps], [1, 1.06], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 14 }),
            output: "perceptual-scale",
          }),
        }}
      >
        CSV
      </Interactive.Div>
      <Interactive.Div
        name="Chip Zoho"
        style={{
          position: "absolute",
          left: 1020,
          top: 480,
          height: 88,
          padding: "0 32px",
          borderRadius: 16,
          border: "1px solid #E2E6EB",
          backgroundColor: "#FFFFFF",
          fontFamily,
          fontSize: 32,
          fontWeight: 600,
          color: "#161A22",
          display: "flex",
          alignItems: "center",
          opacity: interpolate(frame, [2.1 * fps, 2.45 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Zoho
      </Interactive.Div>
      <Interactive.Div
        name="CSV hint"
        style={{
          position: "absolute",
          left: 120,
          top: 620,
          fontFamily,
          fontSize: 28,
          fontWeight: 500,
          color: "#5C6570",
          opacity: interpolate(frame, [2.6 * fps, 3.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Today we upload a CSV and assign Priya.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
