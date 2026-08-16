import "./index.css";
import { Composition, Folder } from "remotion";
import { BolnaFilm } from "./BolnaFilm";
import { Chat } from "./bolna/Chat";
import { Kinetic } from "./bolna/Kinetic";
import { Flip } from "./bolna/Flip";
import { EndCard } from "./bolna/EndCard";
import { EmptySeat } from "./EmptySeat";
import { Tutorial } from "./Tutorial";
import { MeetingFilm } from "./MeetingFilm";
import { World } from "./meeting/World";
import { Host } from "./meeting/Host";
import { Enter } from "./meeting/Enter";
import { Speak } from "./meeting/Speak";
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

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MeetingTalk"
        component={MeetingFilm}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1080}
      />
      <Folder name="Meeting-Scenes">
        <Composition id="M-World" component={World} durationInFrames={600} fps={30} width={1080} height={1080} />
        <Composition id="M-Host" component={Host} durationInFrames={250} fps={30} width={1080} height={1080} />
        <Composition id="M-Enter" component={Enter} durationInFrames={280} fps={30} width={1080} height={1080} />
        <Composition id="M-Speak" component={Speak} durationInFrames={180} fps={30} width={1080} height={1080} />
      </Folder>
      <Composition
        id="Tutorial"
        component={Tutorial}
        durationInFrames={3600}
        fps={30}
        width={1920}
        height={1080}
      />
      <Folder name="Tutorial-Scenes">
        <Composition id="T-Open" component={Open} durationInFrames={240} fps={30} width={1920} height={1080} />
        <Composition id="T-Idea" component={Idea} durationInFrames={300} fps={30} width={1920} height={1080} />
        <Composition id="T-Agent" component={Agent} durationInFrames={420} fps={30} width={1920} height={1080} />
        <Composition id="T-Campaign" component={Campaign} durationInFrames={420} fps={30} width={1920} height={1080} />
        <Composition id="T-Call" component={Call} durationInFrames={360} fps={30} width={1920} height={1080} />
        <Composition id="T-Book" component={Book} durationInFrames={360} fps={30} width={1920} height={1080} />
        <Composition id="T-Join" component={Join} durationInFrames={480} fps={30} width={1920} height={1080} />
        <Composition id="T-Deck" component={Deck} durationInFrames={360} fps={30} width={1920} height={1080} />
        <Composition id="T-WhatsApp" component={WhatsApp} durationInFrames={360} fps={30} width={1920} height={1080} />
        <Composition id="T-Recap" component={Recap} durationInFrames={180} fps={30} width={1920} height={1080} />
        <Composition id="T-End" component={End} durationInFrames={240} fps={30} width={1920} height={1080} />
      </Folder>
      <Composition
        id="BolnaMotion"
        component={BolnaFilm}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1080}
      />
      <Folder name="Bolna-Scenes">
        <Composition
          id="Chat"
          component={Chat}
          durationInFrames={270}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="Kinetic"
          component={Kinetic}
          durationInFrames={156}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="Flip"
          component={Flip}
          durationInFrames={96}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="EndCard"
          component={EndCard}
          durationInFrames={90}
          fps={30}
          width={1080}
          height={1080}
        />
      </Folder>
      <Folder name="EmptySeat-Old">
        <Composition
          id="EmptySeat"
          component={EmptySeat}
          durationInFrames={720}
          fps={30}
          width={1080}
          height={1080}
        />
      </Folder>
    </>
  );
};
