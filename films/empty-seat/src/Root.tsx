import "./index.css";
import { Composition, Folder } from "remotion";
import { EmptySeat } from "./EmptySeat";
import { Ask } from "./scenes/Ask";
import { Sit } from "./scenes/Sit";
import { Present } from "./scenes/Present";
import { Claims } from "./scenes/Claims";
import { End } from "./scenes/End";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="EmptySeat"
        component={EmptySeat}
        durationInFrames={720}
        fps={30}
        width={1080}
        height={1080}
      />
      <Folder name="EmptySeat-Scenes">
        <Composition
          id="Ask"
          component={Ask}
          durationInFrames={150}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="Sit"
          component={Sit}
          durationInFrames={150}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="Present"
          component={Present}
          durationInFrames={180}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="Claims"
          component={Claims}
          durationInFrames={120}
          fps={30}
          width={1080}
          height={1080}
        />
        <Composition
          id="End"
          component={End}
          durationInFrames={120}
          fps={30}
          width={1080}
          height={1080}
        />
      </Folder>
    </>
  );
};
