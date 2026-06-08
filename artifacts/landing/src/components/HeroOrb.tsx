import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/* ── CSS fallback orb when WebGL is unavailable ───────────────────── */
function FallbackOrb({ className }: { className?: string }) {
  return (
    <div className={className} style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{`
        @keyframes orb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes orb-pulse { 0%,100%{opacity:0.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.04)} }
        @keyframes orb-ring1 { from{transform:rotateX(65deg) rotateZ(0deg)} to{transform:rotateX(65deg) rotateZ(360deg)} }
        @keyframes orb-ring2 { from{transform:rotateX(30deg) rotateY(0deg)} to{transform:rotateX(30deg) rotateY(360deg)} }
        @keyframes orb-ring3 { from{transform:rotateX(80deg) rotateY(0deg) rotateZ(20deg)} to{transform:rotateX(80deg) rotateY(360deg) rotateZ(20deg)} }
        @keyframes orb-particles { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
      `}</style>
      <div style={{ position: "relative", width: "min(380px, 80vw)", height: "min(380px, 80vw)" }}>
        {/* Core glow */}
        <div style={{
          position: "absolute", inset: "18%",
          borderRadius: "50%",
          background: "radial-gradient(circle at 35% 35%, #a855f7, #4c1d95 55%, #1a0533)",
          boxShadow: "0 0 60px rgba(124,58,237,0.6), 0 0 120px rgba(124,58,237,0.3), 0 0 200px rgba(124,58,237,0.1)",
          animation: "orb-pulse 3.5s ease-in-out infinite",
        }} />
        {/* Outer haze */}
        <div style={{
          position: "absolute", inset: "5%",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)",
          animation: "orb-pulse 4s ease-in-out infinite 0.5s",
        }} />
        {/* Grid lines on sphere */}
        <div style={{
          position: "absolute", inset: "18%",
          borderRadius: "50%",
          border: "1px solid rgba(139,92,246,0.25)",
          overflow: "hidden",
        }}>
          {[20, 40, 60, 80].map(pct => (
            <div key={pct} style={{
              position: "absolute", left: 0, right: 0,
              top: `${pct}%`,
              height: "1px",
              background: "rgba(139,92,246,0.2)",
            }} />
          ))}
          {[20, 40, 60, 80].map(pct => (
            <div key={pct} style={{
              position: "absolute", top: 0, bottom: 0,
              left: `${pct}%`,
              width: "1px",
              background: "rgba(139,92,246,0.2)",
            }} />
          ))}
        </div>
        {/* Ring 1 */}
        <div style={{
          position: "absolute", inset: "10%",
          borderRadius: "50%",
          border: "1.5px solid rgba(168,85,247,0.4)",
          animation: "orb-ring1 8s linear infinite",
          transformStyle: "preserve-3d",
        }} />
        {/* Ring 2 */}
        <div style={{
          position: "absolute", inset: "6%",
          borderRadius: "50%",
          border: "1px solid rgba(192,132,252,0.25)",
          animation: "orb-ring2 12s linear infinite",
          transformStyle: "preserve-3d",
        }} />
        {/* Ring 3 */}
        <div style={{
          position: "absolute", inset: "2%",
          borderRadius: "50%",
          border: "0.5px solid rgba(139,92,246,0.15)",
          animation: "orb-ring3 18s linear infinite",
          transformStyle: "preserve-3d",
        }} />
        {/* Particle dots */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
          <div key={i} style={{
            position: "absolute",
            top: "50%", left: "50%",
            width: 4, height: 4,
            marginTop: -2, marginLeft: -2,
            borderRadius: "50%",
            background: i % 2 === 0 ? "#a855f7" : "#c084fc",
            boxShadow: `0 0 6px ${i % 2 === 0 ? "#a855f7" : "#c084fc"}`,
            transform: `rotate(${deg}deg) translateX(${i % 2 === 0 ? 175 : 155}px)`,
            opacity: 0.7,
          }} />
        ))}
      </div>
    </div>
  );
}

/* ── WebGL Three.js orb ───────────────────────────────────────────── */
function ThreeOrb({ className }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth || 600;
    const h = mount.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.z = 3.6;

    /* ── Core glow sphere ─────────────────────────────────── */
    const coreGeo = new THREE.SphereGeometry(0.82, 32, 32);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x1a0533, transparent: true, opacity: 0.85 });
    scene.add(new THREE.Mesh(coreGeo, coreMat));

    /* ── Morphing wireframe sphere ────────────────────────── */
    const sphereGeo = new THREE.SphereGeometry(1, 72, 72);
    const origPos = new Float32Array(sphereGeo.attributes.position.array);
    const posAttr = sphereGeo.attributes.position as THREE.BufferAttribute;

    const wireMat = new THREE.MeshPhongMaterial({
      color: 0x8b5cf6, emissive: 0x3b0764, wireframe: true, transparent: true, opacity: 0.55,
    });
    const wireSphere = new THREE.Mesh(sphereGeo, wireMat);
    scene.add(wireSphere);

    /* ── Orbit rings ──────────────────────────────────────── */
    const ringGeo = new THREE.TorusGeometry(1.15, 0.004, 16, 200);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.35 }));
    ring.rotation.x = Math.PI / 2.5;
    scene.add(ring);

    const ring2Geo = new THREE.TorusGeometry(1.22, 0.003, 16, 200);
    const ring2 = new THREE.Mesh(ring2Geo, new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.2 }));
    ring2.rotation.x = Math.PI / 3.5;
    ring2.rotation.y = Math.PI / 6;
    scene.add(ring2);

    /* ── Outer pulse glow ─────────────────────────────────── */
    const outerGeo = new THREE.SphereGeometry(1.35, 32, 32);
    const outerMat = new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.055, side: THREE.BackSide });
    scene.add(new THREE.Mesh(outerGeo, outerMat));
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.65, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.025, side: THREE.BackSide })));

    /* ── Particle halo ────────────────────────────────────── */
    const pCount = 3200;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const r = 1.4 + Math.random() * 1.1;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pPos[i * 3 + 2] = r * Math.cos(phi);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xc084fc, size: 0.013, transparent: true, opacity: 0.45 }));
    scene.add(particles);

    /* ── Lights ───────────────────────────────────────────── */
    scene.add(new THREE.AmbientLight(0x3b0764, 1.2));
    const l1 = new THREE.PointLight(0x8b5cf6, 4, 9);
    l1.position.set(2.5, 2, 2);
    scene.add(l1);
    const l2 = new THREE.PointLight(0xc084fc, 2.5, 9);
    l2.position.set(-2, -1.5, -1);
    scene.add(l2);
    scene.add(Object.assign(new THREE.PointLight(0x06b6d4, 1.5, 7), { position: new THREE.Vector3(0, -2, 2) }));

    /* ── Animation ────────────────────────────────────────── */
    const clock = new THREE.Clock();
    let raf: number;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      for (let i = 0; i < posAttr.count; i++) {
        const ix = i * 3;
        const ox = origPos[ix], oy = origPos[ix + 1], oz = origPos[ix + 2];
        const noise =
          Math.sin(ox * 2.8 + t * 0.9) *
          Math.cos(oy * 2.8 + t * 0.72) *
          Math.sin(oz * 2.2 + t * 1.15) * 0.11;
        (posAttr.array as Float32Array)[ix]     = ox + ox * noise;
        (posAttr.array as Float32Array)[ix + 1] = oy + oy * noise;
        (posAttr.array as Float32Array)[ix + 2] = oz + oz * noise;
      }
      posAttr.needsUpdate = true;
      sphereGeo.computeVertexNormals();

      wireSphere.rotation.y = t * 0.10;
      wireSphere.rotation.x = Math.sin(t * 0.07) * 0.12;
      ring.rotation.z = t * 0.08;
      ring2.rotation.z = -t * 0.06;
      particles.rotation.y = -t * 0.03;
      particles.rotation.x = Math.sin(t * 0.04) * 0.04;

      outerMat.opacity = 0.045 + Math.sin(t * 1.3) * 0.02;
      l1.position.x = 2.5 * Math.cos(t * 0.25);
      l1.position.z = 2.5 * Math.sin(t * 0.25);

      renderer.render(scene, camera);
    };
    animate();

    /* ── Resize ───────────────────────────────────────────── */
    const ro = new ResizeObserver(() => {
      const w2 = mount.clientWidth, h2 = mount.clientHeight;
      if (!w2 || !h2) return;
      renderer.setSize(w2, h2);
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className={className} style={{ width: "100%", height: "100%" }} />;
}

/* ── Exported component: try WebGL, fall back to CSS ─────────────── */
export function HeroOrb({ className }: { className?: string }) {
  const [webglOk] = useState(() => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
      return !!ctx;
    } catch {
      return false;
    }
  });

  if (!webglOk) return <FallbackOrb className={className} />;
  return <ThreeOrb className={className} />;
}
