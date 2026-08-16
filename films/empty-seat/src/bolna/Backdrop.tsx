import { AbsoluteFill, Interactive } from "remotion";

export const Backdrop: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0D0D0E" }}>
      <Interactive.Div
        name="Spotlight"
        style={{
          position: "absolute",
          left: 140,
          top: 80,
          width: 800,
          height: 800,
          background:
            "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 62%)",
        }}
      />
      <Interactive.Div
        name="Blueprint grid"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1080,
          height: 1080,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <Interactive.Div
        name="Grain"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1080,
          height: 1080,
          opacity: 0.14,
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.3) 0.55px, transparent 0.7px)",
          backgroundSize: "3px 3px",
        }}
      />
      <Interactive.Div
        name="Vignette"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1080,
          height: 1080,
          boxShadow: "inset 0 0 150px 40px #000",
        }}
      />
    </AbsoluteFill>
  );
};
