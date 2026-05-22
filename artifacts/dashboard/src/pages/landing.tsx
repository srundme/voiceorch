import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { SnapServeLogo, SnapServeIcon } from "@/components/logo";
import { ArrowRight, Check } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── 3D Perspective Pipeline Canvas ────────────────────────────────────── */
function PipelineScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let t = 0;

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const cx = W * 0.5;
      const cy = H * 0.52;
      const fov = 340;

      /* ── Perspective grid ── */
      const COLS = 14, ROWS = 22;
      const GW = 420, GH = 420;
      const tilt = Math.sin(t * 0.0004) * 0.018; // very subtle sway

      function project(x: number, z: number): [number, number, number] {
        const rx = x * Math.cos(tilt) - z * Math.sin(tilt);
        const rz = x * Math.sin(tilt) + z * Math.cos(tilt);
        const scale = fov / (fov + rz + 220);
        return [cx + rx * scale, cy + rz * scale * 0.55, scale];
      }

      ctx.save();
      // Fade grid at edges
      const gridFade = ctx.createRadialGradient(cx, cy + 40, 10, cx, cy + 40, GW * 0.85);
      gridFade.addColorStop(0,   "rgba(255,255,255,0.06)");
      gridFade.addColorStop(0.7, "rgba(255,255,255,0.03)");
      gridFade.addColorStop(1,   "rgba(255,255,255,0)");

      // Grid columns
      for (let i = 0; i <= COLS; i++) {
        const gx = (i / COLS - 0.5) * GW;
        ctx.beginPath();
        ctx.strokeStyle = gridFade;
        ctx.lineWidth = 0.5;
        for (let j = 0; j <= ROWS; j++) {
          const gz = (j / ROWS - 0.5) * GH + (t * 0.025 % (GH / ROWS));
          const [px, py] = project(gx, gz);
          j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      // Grid rows
      for (let j = 0; j <= ROWS; j++) {
        const gz = (j / ROWS - 0.5) * GH + (t * 0.025 % (GH / ROWS));
        ctx.beginPath();
        ctx.strokeStyle = gridFade;
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= COLS; i++) {
          const gx = (i / COLS - 0.5) * GW;
          const [px, py] = project(gx, gz);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();

      /* ── Pipeline nodes ── */
      const nodes = [
        { label: "ASR",      sub: "Deepgram Nova-3",  x: -130, z: -80,  col: [100, 200, 255] as [number,number,number], r: 28 },
        { label: "LLM",      sub: "GPT-4o mini",      x:    0, z:  20,  col: [160, 100, 255] as [number,number,number], r: 34 },
        { label: "TTS",      sub: "Cartesia Sonic-2", x:  130, z: -80,  col: [80,  220, 180] as [number,number,number], r: 28 },
      ];

      const floatY = Math.sin(t * 0.0012) * 6;

      // Draw connection lines between nodes
      const projected = nodes.map(n => project(n.x, n.z));
      for (let i = 0; i < projected.length - 1; i++) {
        const [x1, y1] = projected[i]!;
        const [x2, y2] = projected[i + 1]!;
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        const c1 = nodes[i]!.col;
        const c2 = nodes[i + 1]!.col;
        grad.addColorStop(0,   `rgba(${c1[0]},${c1[1]},${c1[2]},0.5)`);
        grad.addColorStop(0.5, `rgba(200,160,255,0.3)`);
        grad.addColorStop(1,   `rgba(${c2[0]},${c2[1]},${c2[2]},0.5)`);
        ctx.beginPath();
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -(t * 0.12);
        ctx.moveTo(x1, y1 + floatY);
        ctx.lineTo(x2, y2 + floatY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Caller node (top-left)
      {
        const [px, py, sc] = project(-210, -130);
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(px, py + floatY, 18 * sc, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(80,80,120,0.3)";
        ctx.strokeStyle = "rgba(150,150,200,0.3)";
        ctx.lineWidth = 1;
        ctx.fill(); ctx.stroke();
        ctx.font = `${Math.round(8 * sc)}px monospace`;
        ctx.fillStyle = "rgba(200,200,255,0.5)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("IN", px, py + floatY);
        ctx.restore();
      }

      // Response node (top-right)
      {
        const [px, py, sc] = project(210, -130);
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(px, py + floatY, 18 * sc, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(30,100,70,0.3)";
        ctx.strokeStyle = "rgba(80,220,160,0.3)";
        ctx.lineWidth = 1;
        ctx.fill(); ctx.stroke();
        ctx.font = `${Math.round(8 * sc)}px monospace`;
        ctx.fillStyle = "rgba(80,220,160,0.6)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("OUT", px, py + floatY);
        ctx.restore();
      }

      // Main pipeline nodes
      nodes.forEach(({ label, sub, x, z, col, r }, idx) => {
        const [px, py, sc] = project(x, z);
        const fy = py + floatY + Math.sin(t * 0.0012 + idx * 1.2) * 4;
        const [cr, cg, cb] = col;
        const radius = r * sc;

        // Outer glow ring
        const glow = ctx.createRadialGradient(px, fy, 0, px, fy, radius * 3.2);
        glow.addColorStop(0,   `rgba(${cr},${cg},${cb},0.18)`);
        glow.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.08)`);
        glow.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
        ctx.beginPath();
        ctx.arc(px, fy, radius * 3.2, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Node body
        const body = ctx.createRadialGradient(px - radius * 0.25, fy - radius * 0.25, 0, px, fy, radius);
        body.addColorStop(0, `rgba(${cr},${cg},${cb},0.35)`);
        body.addColorStop(1, `rgba(${Math.round(cr*0.3)},${Math.round(cg*0.3)},${Math.round(cb*0.3)},0.6)`);
        ctx.beginPath();
        ctx.arc(px, fy, radius, 0, Math.PI * 2);
        ctx.fillStyle = body;
        ctx.fill();

        // Border
        ctx.beginPath();
        ctx.arc(px, fy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.55)`;
        ctx.lineWidth = 1.5 * sc;
        ctx.stroke();

        // Label
        ctx.font = `bold ${Math.round(10 * sc)}px ui-monospace, monospace`;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.95)`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, px, fy);

        // Sub-label below node
        ctx.font = `${Math.round(7.5 * sc)}px ui-sans-serif, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.fillText(sub, px, fy + radius + 12 * sc);
      });

      /* ── Latency tags floating above center node ── */
      const [cx2, cy2] = project(0, 20);
      const tags = [
        { label: "184ms total", col: [180, 130, 255] as [number,number,number] },
      ];
      tags.forEach(({ label, col }) => {
        const tx = cx2, ty = cy2 + floatY - 60;
        const [cr, cg, cb] = col;
        ctx.save();
        ctx.font = "bold 11px ui-monospace, monospace";
        const tw = ctx.measureText(label).width;
        ctx.beginPath();
        ctx.roundRect(tx - tw / 2 - 8, ty - 10, tw + 16, 20, 10);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.12)`;
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.35)`;
        ctx.lineWidth = 1;
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.9)`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, tx, ty);
        ctx.restore();
      });

      t += 0.8;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

/* ─── Animated counter ───────────────────────────────────────────────────── */
function Counter({ to, suffix = "", prefix = "" }: { to: number; suffix?: string; prefix?: string }) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      obs.disconnect();
      const dur = 1600, s = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - s) / dur, 1);
        setN(Math.floor((1 - Math.pow(1 - p, 4)) * to));
        if (p < 1) requestAnimationFrame(tick);
        else setN(to);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [to]);
  return <div ref={ref}>{prefix}{n.toLocaleString()}{suffix}</div>;
}

/* ─── Reusable section label ─────────────────────────────────────────────── */
function Label({ text }: { text: string }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-violet-400 mb-4">{text}</p>
  );
}

/* ─── Feature row ────────────────────────────────────────────────────────── */
function FeatureRow({ label, title, body, visual }: {
  label: string; title: string; body: string; visual: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center py-20 border-b border-white/[0.06]">
      <div>
        <Label text={label} />
        <h2 className="text-[40px] sm:text-[52px] font-black tracking-tight leading-[1.0] text-white mb-6">{title}</h2>
        <p className="text-[15px] text-white/40 leading-[1.75] max-w-md">{body}</p>
      </div>
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden aspect-[4/3] flex items-center justify-center">
        {visual}
      </div>
    </div>
  );
}

/* ─── Code-block visual ──────────────────────────────────────────────────── */
function CodeBlock({ lines }: { lines: { t: string; c: string }[] }) {
  return (
    <div className="w-full h-full flex flex-col gap-0 p-6 font-mono text-[12px]">
      <div className="flex items-center gap-1.5 mb-4">
        {["#FF5F57","#FEBC2E","#28C840"].map(c => (
          <div key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />
        ))}
      </div>
      {lines.map(({ t, c }, i) => (
        <div key={i} className="flex gap-4 leading-6">
          <span className="text-white/15 w-4 text-right shrink-0">{i + 1}</span>
          <span style={{ color: c }}>{t}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Use case card ──────────────────────────────────────────────────────── */
function UCCard({ title, kpi, body }: { title: string; kpi: string; body: string }) {
  return (
    <div className="group flex flex-col gap-3 p-6 rounded-2xl border border-white/[0.06] hover:border-white/[0.1] bg-white/[0.01] hover:bg-white/[0.03] transition-all duration-300">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14px] font-bold text-white/80 group-hover:text-white transition-colors">{title}</h3>
        <span className="shrink-0 text-[10px] font-black text-violet-300 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">{kpi}</span>
      </div>
      <p className="text-[12px] text-white/30 leading-[1.7]">{body}</p>
    </div>
  );
}

/* ─── Pricing card ───────────────────────────────────────────────────────── */
function PCard({ plan, price, per, note, items, cta, hot }: {
  plan: string; price: string; per: string; note: string;
  items: string[]; cta: string; hot?: boolean;
}) {
  return (
    <div className={`relative flex flex-col gap-6 p-6 rounded-2xl border transition-all ${hot ? "border-violet-500/40 bg-violet-500/5" : "border-white/[0.07] bg-white/[0.015]"}`}>
      {hot && (
        <div className="absolute -top-3 left-6">
          <span className="text-[9px] font-black uppercase tracking-widest bg-violet-600 text-white px-3 py-1 rounded-full">
            Most popular
          </span>
        </div>
      )}
      <div className="pt-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-white/25 mb-5">{plan}</p>
        <div className="flex items-end gap-1.5 mb-1">
          <span className="text-[36px] font-black text-white leading-none">{price}</span>
          {per && <span className="text-[13px] text-white/30 mb-1.5">{per}</span>}
        </div>
        <p className="text-[12px] text-white/25">{note}</p>
      </div>
      <div className="h-px bg-white/[0.06]" />
      <ul className="flex flex-col gap-3 flex-1">
        {items.map(item => (
          <li key={item} className="flex items-start gap-2.5 text-[13px] text-white/50">
            <Check className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
      <Link href={`${basePath}/sign-up`}>
        <button className={`w-full py-3 rounded-full text-[13px] font-bold transition-all duration-200 ${hot
          ? "bg-white text-black hover:bg-white/90"
          : "border border-white/[0.1] text-white/50 hover:border-white/[0.2] hover:text-white/70"
        }`}>{cta}</button>
      </Link>
    </div>
  );
}

/* ─── Provider chip ──────────────────────────────────────────────────────── */
function Chip({ name, tag }: { name: string; tag: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1] transition-colors cursor-default">
      <div className="h-5 w-5 rounded-md bg-white/[0.07] flex items-center justify-center shrink-0">
        <span className="text-[8px] font-black text-white/40">{name.slice(0, 2).toUpperCase()}</span>
      </div>
      <div>
        <div className="text-[11px] font-semibold text-white/65 leading-none">{name}</div>
        <div className="text-[9px] text-white/25 mt-0.5">{tag}</div>
      </div>
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white antialiased overflow-x-hidden">

      {/* ── Nav ───────────────────────────────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-8 h-14 border-b border-white/[0.05] bg-black/80 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-600">
            <SnapServeIcon size={13} className="text-white" />
          </div>
          <SnapServeLogo size="sm" className="text-white" />
        </div>

        <nav className="hidden md:flex items-center gap-7">
          {[["Product", "#product"], ["Use Cases", "#use-cases"], ["Pricing", "#pricing"], ["Docs", "#"]].map(([l, h]) => (
            <a key={l} href={h}
              className="text-[13px] font-medium text-white/40 hover:text-white/75 transition-colors">
              {l}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link href={`${basePath}/sign-in`}>
            <button className="text-[13px] font-medium text-white/40 hover:text-white/70 transition-colors px-3 py-1.5">
              Sign in
            </button>
          </Link>
          <Link href={`${basePath}/sign-up`}>
            <button className="flex items-center gap-1.5 bg-white text-black text-[13px] font-bold px-4 py-1.5 rounded-full hover:bg-white/90 transition-all">
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative min-h-screen grid grid-cols-1 lg:grid-cols-2 pt-14">

        {/* Left: text */}
        <div className="flex flex-col justify-center px-10 lg:px-16 py-20 lg:py-0">
          <div className="inline-flex items-center gap-2 mb-8 w-fit px-3 py-1 rounded-full border border-white/[0.1] text-[11px] font-semibold text-white/50">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            From $0.03 / min &mdash; BYOK or Managed
          </div>

          <h1 className="text-[52px] sm:text-[64px] lg:text-[72px] font-black tracking-[-0.035em] leading-[0.95] mb-8 text-white">
            AI voice<br />agents,<br />
            <span className="text-white/35">built to</span><br />
            <span style={{
              background: "linear-gradient(90deg, #a78bfa 0%, #818cf8 40%, #60a5fa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}>deploy.</span>
          </h1>

          <p className="text-[15px] text-white/40 leading-[1.75] max-w-sm mb-10">
            Real-time orchestration infrastructure. Connect your ASR, LLM, and TTS providers — or use ours.
            We handle the pipeline so you ship the agent.
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <Link href={`${basePath}/sign-up`}>
              <button className="flex items-center gap-2 bg-white text-black text-[14px] font-bold px-6 py-3 rounded-full hover:bg-white/90 transition-all">
                Get started <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
            <a href="#product">
              <button className="text-[14px] font-medium text-white/40 border border-white/[0.1] px-6 py-3 rounded-full hover:border-white/[0.2] hover:text-white/60 transition-all">
                See how it works
              </button>
            </a>
          </div>

          <p className="text-[11px] text-white/20 mt-5">$5 credit on signup — no card required</p>
        </div>

        {/* Right: 3D pipeline visual */}
        <div className="relative hidden lg:flex items-center justify-center overflow-hidden">
          {/* Radial fade from right edge */}
          <div className="absolute inset-0 bg-gradient-to-l from-black/0 via-black/0 to-black/60 z-10 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/20 z-10 pointer-events-none" />

          <PipelineScene />

          {/* Floating stat cards */}
          <div className="absolute top-1/4 right-8 z-20 flex flex-col gap-2">
            {[
              { label: "ASR", value: "62ms",  col: "#67e8f9" },
              { label: "LLM", value: "94ms",  col: "#c4b5fd" },
              { label: "TTS", value: "28ms",  col: "#6ee7b7" },
            ].map(({ label, value, col }) => (
              <div key={label} className="flex items-center gap-2.5 bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm px-3 py-2 rounded-xl">
                <span className="text-[10px] font-bold" style={{ color: col }}>{label}</span>
                <span className="text-[12px] font-black text-white font-mono">{value}</span>
              </div>
            ))}
          </div>

          {/* Bottom live indicator */}
          <div className="absolute bottom-8 right-8 z-20 flex items-center gap-2 bg-white/[0.03] border border-white/[0.07] px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-white/40">Live session active</span>
          </div>
        </div>
      </section>

      {/* ── Metrics ───────────────────────────────────────────────── */}
      <section className="border-y border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 divide-x divide-white/[0.06]">
          {[
            { to: 10,  s: "M+",   p: "",  l: "Minutes processed" },
            { to: 184, s: "ms",   p: "<", l: "Pipeline latency" },
            { to: 15,  s: "+",    p: "",  l: "Provider integrations" },
            { to: 99,  s: ".9%",  p: "",  l: "Uptime SLA" },
          ].map(({ to, s, p, l }) => (
            <div key={l} className="flex flex-col items-center py-10 gap-1.5">
              <div className="text-[30px] font-black text-white tabular-nums">
                <Counter to={to} suffix={s} prefix={p} />
              </div>
              <p className="text-[11px] text-white/25 font-medium">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Feature rows ──────────────────────────────────────────── */}
      <section id="product" className="max-w-5xl mx-auto px-8 lg:px-10">
        <FeatureRow
          label="Pipeline"
          title={"Sub-200ms,\nend-to-end."}
          body="Streaming ASR with token-level LLM output and parallel TTS synthesis. Callers hear a response before generation finishes. Every millisecond instrumented."
          visual={
            <div className="w-full h-full p-6 flex flex-col gap-3 font-mono text-[12px]">
              {[
                { stage: "CALLER IN",  ms: "0ms",    bar: 2,   col: "#94a3b8" },
                { stage: "ASR",        ms: "62ms",   bar: 33,  col: "#67e8f9" },
                { stage: "LLM TTFT",   ms: "94ms",   bar: 50,  col: "#c4b5fd" },
                { stage: "TTS",        ms: "28ms",   bar: 15,  col: "#6ee7b7" },
                { stage: "TOTAL",      ms: "184ms",  bar: 100, col: "#a78bfa" },
              ].map(({ stage, ms, bar, col }) => (
                <div key={stage} className="flex items-center gap-3">
                  <span className="w-20 text-right text-white/30 text-[10px]">{stage}</span>
                  <div className="flex-1 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${bar}%`, background: col, boxShadow: `0 0 8px ${col}` }} />
                  </div>
                  <span className="w-10 text-[11px] font-bold" style={{ color: col }}>{ms}</span>
                </div>
              ))}
            </div>
          }
        />

        <FeatureRow
          label="Flexibility"
          title={"BYOK or\nmanaged."}
          body="Bring your own Deepgram, OpenAI, Twilio credentials for full cost control and zero lock-in. Or flip a switch and use our managed keys at $0.035/min — same API, zero setup."
          visual={
            <CodeBlock lines={[
              { t: "# Use your own keys", c: "#6b7280" },
              { t: 'asr_provider: "deepgram"', c: "#c4b5fd" },
              { t: 'asr_key: "dg-xxxxxxxxxxxx"', c: "#f9a8d4" },
              { t: "", c: "" },
              { t: "# Or use managed", c: "#6b7280" },
              { t: 'asr_provider: "deepgram"', c: "#c4b5fd" },
              { t: 'asr_key: "managed"', c: "#6ee7b7" },
              { t: "", c: "" },
              { t: "# Same config. Zero setup.", c: "#6b7280" },
            ]} />
          }
        />

        <FeatureRow
          label="Languages"
          title={"Multilingual\nout of the box."}
          body="Hindi, Tamil, Telugu, Malayalam, Bengali, English and more. Sarvam ASR for Indic languages, multilingual LLM routing, and Indian-accent TTS voices built in."
          visual={
            <div className="w-full h-full p-6 flex flex-col justify-center gap-3">
              {[
                { lang: "Hindi",     code: "hi-IN", active: true },
                { lang: "Tamil",     code: "ta-IN", active: true },
                { lang: "Telugu",    code: "te-IN", active: true },
                { lang: "Malayalam", code: "ml-IN", active: false },
                { lang: "English",   code: "en-IN", active: true },
              ].map(({ lang, code, active }) => (
                <div key={lang} className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${active ? "bg-emerald-400" : "bg-white/20"}`} />
                    <span className="text-[13px] font-semibold text-white/70">{lang}</span>
                  </div>
                  <span className="text-[10px] font-mono text-white/25">{code}</span>
                </div>
              ))}
            </div>
          }
        />
      </section>

      {/* ── Provider grid ─────────────────────────────────────────── */}
      <section className="border-y border-white/[0.06] py-16">
        <div className="max-w-5xl mx-auto px-8 lg:px-10">
          <Label text="Integrations" />
          <h2 className="text-[36px] font-black tracking-tight text-white mb-2">Your stack. Your choice.</h2>
          <p className="text-[13px] text-white/30 mb-10">Every major provider across the full pipeline.</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {[
              { name: "Deepgram",   tag: "ASR" },
              { name: "Sarvam",     tag: "ASR · LLM" },
              { name: "Whisper",    tag: "ASR" },
              { name: "OpenAI",     tag: "LLM · TTS" },
              { name: "Anthropic",  tag: "LLM" },
              { name: "Google",     tag: "LLM" },
              { name: "Groq",       tag: "LLM" },
              { name: "DeepSeek",   tag: "LLM" },
              { name: "Mistral",    tag: "LLM" },
              { name: "ElevenLabs", tag: "TTS" },
              { name: "Cartesia",   tag: "TTS" },
              { name: "AWS Polly",  tag: "TTS" },
              { name: "Twilio",     tag: "Telephony" },
              { name: "Plivo",      tag: "Telephony" },
              { name: "VoBiz",      tag: "Telephony" },
              { name: "Vonage",     tag: "Telephony" },
            ].map(p => <Chip key={p.name} {...p} />)}
            <div className="flex items-center justify-center px-3 py-2 rounded-xl border border-dashed border-white/[0.05] text-[10px] text-white/18">
              + more
            </div>
          </div>
        </div>
      </section>

      {/* ── Use cases ─────────────────────────────────────────────── */}
      <section id="use-cases" className="max-w-5xl mx-auto px-8 lg:px-10 py-20">
        <Label text="Use cases" />
        <h2 className="text-[36px] font-black tracking-tight text-white mb-10">What teams ship</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <UCCard title="Customer Support"        kpi="24/7"         body="Handle FAQs, status updates, complaints. Escalate to human only when needed." />
          <UCCard title="Sales Outreach"           kpi="3× lift"      body="Qualify leads, pitch the product, book demos at scale — no SDR time wasted." />
          <UCCard title="Collections & Reminders"  kpi="40% recovery" body="Automate EMI nudges, overdue follow-ups, and payment reminders in any language." />
          <UCCard title="Appointment Scheduling"   kpi="Zero no-shows" body="Confirm, reschedule, remind patients, clients, or candidates ahead of time." />
          <UCCard title="COD Confirmation"         kpi="99% accuracy"  body="Confirm orders before dispatch, reduce RTO, save last-mile cost." />
          <UCCard title="Lead Qualification"       kpi="5× pipeline"  body="Run qualification instantly on form submit. Score and route to the right rep." />
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────── */}
      <section id="pricing" className="border-t border-white/[0.06] py-20">
        <div className="max-w-5xl mx-auto px-8 lg:px-10">
          <Label text="Pricing" />
          <h2 className="text-[36px] font-black tracking-tight text-white mb-2">Usage-based. No surprises.</h2>
          <p className="text-[13px] text-white/30 mb-12">No seats. No monthly minimums. Pay per minute.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <PCard plan="Starter" price="$0.03" per="/ min" note="Bring your own provider keys"
              items={["Full BYOK — total cost control", "Unlimited agents", "Call transcripts + analytics", "Deepgram, OpenAI, Twilio", "$5 credit on signup"]}
              cta="Start free" />
            <PCard plan="Managed" price="$0.035" per="/ min" note="We manage all provider keys"
              items={["Zero setup — keys managed by us", "Indian language support", "Cartesia voices included", "Priority routing + SLA uptime", "Real-time monitoring dashboard"]}
              cta="Get started" hot />
            <PCard plan="Enterprise" price="Custom" per="" note="High-volume or on-premise"
              items={["Dedicated infrastructure", "Custom SLA + support tier", "On-premise deployment", "SSO + advanced security", "Dedicated success engineer"]}
              cta="Talk to us" />
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────── */}
      <section className="py-24 px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-[48px] sm:text-[60px] font-black tracking-[-0.03em] leading-[1.0] text-white mb-5">
            First agent live<br />
            <span className="text-white/30">in under 10 minutes.</span>
          </h2>
          <p className="text-[14px] text-white/35 mb-8 max-w-md mx-auto leading-[1.75]">
            No WebSocket code. No infra to manage. Write a prompt, pick a voice, connect a number.
          </p>
          <Link href={`${basePath}/sign-up`}>
            <button className="inline-flex items-center gap-2 bg-white text-black text-[14px] font-bold px-8 py-3.5 rounded-full hover:bg-white/90 transition-all">
              Start building free <ArrowRight className="h-4 w-4" />
            </button>
          </Link>
          <p className="text-[11px] text-white/18 mt-4">$5 credit included — no card required</p>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.05] py-7 px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-600/70">
              <SnapServeIcon size={11} className="text-white" />
            </div>
            <span className="text-[12px] font-bold text-white/25">SnapServe</span>
          </div>
          <p className="text-[11px] text-white/15">AI Voice Agent Orchestration Platform</p>
          <div className="flex items-center gap-5">
            {["Privacy", "Terms", "Docs", "Status"].map(l => (
              <a key={l} href="#" className="text-[11px] text-white/20 hover:text-white/45 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
