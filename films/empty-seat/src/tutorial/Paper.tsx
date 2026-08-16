import { AbsoluteFill, Interactive } from "remotion";

export const Paper: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#F4F6F8" }}>
      <Interactive.Div
        name="Paper grain"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          opacity: 0.35,
          backgroundImage:
            "radial-gradient(circle, rgba(22,26,34,0.18) 0.5px, transparent 0.7px)",
          backgroundSize: "3px 3px",
        }}
      />
    </AbsoluteFill>
  );
};
