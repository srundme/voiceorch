import "./index.css";
import { Composition, Folder } from "remotion";
import { BolnaFilm } from "./BolnaFilm";
import { Chat } from "./bolna/Chat";
import { Kinetic } from "./bolna/Kinetic";
import { Flip } from "./bolna/Flip";
import { EndCard } from "./bolna/EndCard";
import { EmptySeat } from "./EmptySeat";

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
