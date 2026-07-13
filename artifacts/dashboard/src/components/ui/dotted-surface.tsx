import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import * as THREE from "three";

type DottedSurfaceProps = Omit<ComponentProps<"div">, "ref"> & {
  children?: ReactNode;
};

function resolveIsDark(theme: "dark" | "light" | "system"): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function DottedSurface({ className, children, ...props }: DottedSurfaceProps) {
  const { theme } = useTheme();
  const isDark = resolveIsDark(theme);
  const [mounted, setMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    geometry: THREE.BufferGeometry;
    material: THREE.PointsMaterial;
    points: THREE.Points;
    animationId: number;
    count: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    const container = containerRef.current;
    const SEPARATION = 150;
    const AMOUNTX = 40;
    const AMOUNTY = 60;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(isDark ? 0x0a0a0a : 0xffffff, 2000, 10000);

    const camera = new THREE.PerspectiveCamera(60, 1, 1, 10000);
    camera.position.set(0, 355, 1220);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    const positions: number[] = [];
    const colors: number[] = [];
    // PointsMaterial vertexColors expect 0–1 RGB
    const r = isDark ? 0.78 : 0.12;
    const g = isDark ? 0.78 : 0.12;
    const b = isDark ? 0.78 : 0.12;

    for (let ix = 0; ix < AMOUNTX; ix++) {
      for (let iy = 0; iy < AMOUNTY; iy++) {
        const x = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
        const z = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;
        positions.push(x, 0, z);
        colors.push(r, g, b);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 8,
      vertexColors: true,
      transparent: true,
      opacity: isDark ? 0.55 : 0.4,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let count = 0;
    let animationId = 0;
    let disposed = false;

    const setSize = () => {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      if (width <= 0 || height <= 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    setSize();

    const animate = () => {
      if (disposed) return;
      animationId = requestAnimationFrame(animate);
      if (sceneRef.current) sceneRef.current.animationId = animationId;

      const positionAttribute = geometry.attributes.position;
      const pos = positionAttribute.array as Float32Array;

      let i = 0;
      for (let ix = 0; ix < AMOUNTX; ix++) {
        for (let iy = 0; iy < AMOUNTY; iy++) {
          const index = i * 3;
          pos[index + 1] =
            Math.sin((ix + count) * 0.3) * 50 +
            Math.sin((iy + count) * 0.5) * 50;
          i++;
        }
      }

      positionAttribute.needsUpdate = true;
      renderer.render(scene, camera);
      count += 0.1;
    };

    const resizeObserver = new ResizeObserver(() => setSize());
    resizeObserver.observe(container);
    window.addEventListener("resize", setSize);

    animate();

    sceneRef.current = {
      scene,
      camera,
      renderer,
      geometry,
      material,
      points,
      animationId,
      count,
    };

    return () => {
      disposed = true;
      window.removeEventListener("resize", setSize);
      resizeObserver.disconnect();
      cancelAnimationFrame(animationId);

      geometry.dispose();
      material.dispose();
      renderer.dispose();
      scene.remove(points);

      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
      sceneRef.current = null;
    };
  }, [mounted, isDark]);

  return (
    <div
      ref={containerRef}
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
      aria-hidden
      {...props}
    >
      {children}
    </div>
  );
}
