import { AbsoluteFill, Sequence, staticFile, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import { MeetingWorld } from "./MeetingWorld";
import { Ask } from "./scenes/Ask";
import { Sit } from "./scenes/Sit";
import { Present } from "./scenes/Present";
import { Claims } from "./scenes/Claims";
import { End } from "./scenes/End";

export const EmptySeat: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#050505" }}>
      <Audio src={staticFile("music.mp3")} volume={0.18} />
      <MeetingWorld />
      <Sequence from={0} durationInFrames={8.4 * fps} name="Ask">
        <Ask />
      </Sequence>
      <Sequence from={4.5 * fps} durationInFrames={8 * fps} name="Sit">
        <Sit />
      </Sequence>
      <Sequence from={10 * fps} durationInFrames={6 * fps} name="Present">
        <Present />
      </Sequence>
      <Sequence from={16 * fps} durationInFrames={4.2 * fps} name="Claims">
        <Claims />
      </Sequence>
      <Sequence from={20 * fps} durationInFrames={4 * fps} name="End">
        <End />
      </Sequence>
    </AbsoluteFill>
  );
};
