import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { World } from "./meeting/World";
import { Host } from "./meeting/Host";
import { Enter } from "./meeting/Enter";
import { Speak } from "./meeting/Speak";
import { Flip } from "./bolna/Flip";
import { EndCard } from "./bolna/EndCard";

export const MeetingFilm: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0D0D0E" }}>
      <World />
      <Host />
      <Enter />
      <Sequence from={9 * fps} durationInFrames={6 * fps} name="Speak">
        <Speak />
      </Sequence>
      <Sequence from={14.2 * fps} durationInFrames={3.2 * fps} name="Flip">
        <Flip />
      </Sequence>
      <Sequence from={17 * fps} durationInFrames={3 * fps} name="End">
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
