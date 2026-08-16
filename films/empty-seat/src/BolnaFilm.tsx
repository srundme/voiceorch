import { AbsoluteFill, Sequence, staticFile, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import { Backdrop } from "./bolna/Backdrop";
import { Chat } from "./bolna/Chat";
import { Kinetic } from "./bolna/Kinetic";
import { Flip } from "./bolna/Flip";
import { EndCard } from "./bolna/EndCard";

export const BolnaFilm: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0D0D0E" }}>
      <Audio src={staticFile("music.mp3")} volume={0.18} />
      <Backdrop />
      <Chat />
      <Sequence from={9 * fps} durationInFrames={5.2 * fps} name="Kinetic">
        <Kinetic />
      </Sequence>
      <Sequence from={14 * fps} durationInFrames={3.2 * fps} name="Flip">
        <Flip />
      </Sequence>
      <Sequence from={17 * fps} durationInFrames={3 * fps} name="End">
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
