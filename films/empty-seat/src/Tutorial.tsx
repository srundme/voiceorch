import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Open } from "./tutorial/Open";
import { Idea } from "./tutorial/Idea";
import { Agent } from "./tutorial/Agent";
import { Campaign } from "./tutorial/Campaign";
import { Call } from "./tutorial/Call";
import { Book } from "./tutorial/Book";
import { Join } from "./tutorial/Join";
import { Deck } from "./tutorial/Deck";
import { WhatsApp } from "./tutorial/WhatsApp";
import { Recap } from "./tutorial/Recap";
import { End } from "./tutorial/End";

export const Tutorial: React.FC = () => {
  const fadeFor = linearTiming({ durationInFrames: 12 });

  return (
    <AbsoluteFill style={{ backgroundColor: "#F4F6F8" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={240} name="Open">
          <Open />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={300} name="Idea">
          <Idea />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={420} name="Agent">
          <Agent />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={420} name="Campaign">
          <Campaign />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={360} name="Call">
          <Call />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={360} name="Book">
          <Book />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={480} name="Join">
          <Join />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={360} name="Deck">
          <Deck />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={360} name="WhatsApp">
          <WhatsApp />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={180} name="Recap">
          <Recap />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={fadeFor} />
        <TransitionSeries.Sequence durationInFrames={240} name="End">
          <End />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
