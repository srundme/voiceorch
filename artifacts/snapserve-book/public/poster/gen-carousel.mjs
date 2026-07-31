import { writeFileSync } from "fs";

const slides = [
  { kicker:"ANNOUNCING", l1:"india's biggest<br>voice-a-thon", l2:"for Tamil Nadu", body:[], big:"₹1,00,000 PRIZE POOL · 5 WINNERS", art:"px-c1-hall.png", artW:640, artH:560, logos:true, cta:"SAT, SEP 5 · CHENNAI" },
  { kicker:"HOW TO JOIN — STEP 1", l1:"register on<br>luma", body:["Find the event link on our page and hit <b>Request to Join</b>","Solo, or as a team of <b>2–3 members</b>","Registration closes <b>Aug 15, 11:59 PM</b>"], art:"px-c2-register.png", artW:440, artH:480 },
  { kicker:"HOW TO JOIN — STEP 2", l1:"sign up on<br>snapserve.ai", body:["Create your free account at <b>snapserve.ai</b>","Get confirmed and receive <b>free SnapServe platform credits</b>","Start building immediately — practise, test, iterate before Demo Day"], art:"px-c3-signup.png", artW:470, artH:470 },
  { kicker:"HOW TO JOIN — STEP 3", l1:"deploy on a real<br>phone number", body:["Get your <b>Vobiz number</b> right from the <b>SnapServe dashboard</b> — no separate setup","Powered by <b>Vobiz — the most advanced AI telephony</b> for your AI agent","<b>Mandatory</b> — agents without a phone number are not eligible"], art:"px-c4-deploy.png", artW:440, artH:460 },
  { kicker:"DEMO DAY — ROUND 1", l1:"judges come<br>to your table", body:["You demo your agent <b>live via a real phone call</b>","Show a real workflow solving a real problem","Then… the <b>Top 20 teams</b> are revealed"], art:"px-c5-judges.png", artW:520, artH:480 },
  { kicker:"DEMO DAY — THE FINALE", l1:"2 hours.<br>live on stage.", body:["A <b>live problem statement</b> is announced on stage","Finalists build, test and present a <b>brand-new agent from scratch</b>","<b>Top 5 winners</b> + the Participants' Choice Award are crowned"], art:"px-c6-finale.png", artW:500, artH:480 },
  { kicker:"PRIZES", l1:"₹1,00,000<br>prize pool", body:["<b>1st — ₹50,000</b> cash + Trophy + SnapServe & Vobiz credits","<b>2nd — ₹30,000</b> cash + Trophy + SnapServe & Vobiz credits","<b>3rd — ₹20,000</b> cash + Trophy + SnapServe & Vobiz credits"], art:"px-c7-trophy.png", artW:430, artH:470 },
  { kicker:"PRIZES", l1:"more ways<br>to win", body:["<b>4th & 5th</b> — Trophy + SnapServe credits","<b>Participants' Choice Award</b> — voted by the participants themselves","Every confirmed builder gets free platform credits"], art:"px-c8-awards.png", artW:470, artH:430 },
  { kicker:"HOW YOU'RE JUDGED — 1/2", l1:"solve a real<br>problem", body:["<b>Problem clarity & business impact</b> — a real problem, not a feature demo","<b>Language accuracy</b> — how well your agent understands & responds in its language","Latency isn't held against you — it's model-dependent"], art:"px-c9-language.png", artW:440, artH:430 },
  { kicker:"HOW YOU'RE JUDGED — 2/2", l1:"design the<br>full flow", body:["<b>Call flow design</b> — clean, logical conversation; bonus for Squad agents on multi-step problems","<b>Lead automation</b> — connected to a real lead source (website form or Sheet), end to end"], art:"px-c10-flow.png", artW:450, artH:440 },
  { kicker:"WHAT YOU'LL BUILD ON — 1/3", l1:"the full voice-<br>agent stack", body:["<b>Multilingual voice</b> — Tamil, Hindi, Kannada, Telugu, Hinglish & more, built in","<b>Live phone calls</b> — real inbound & outbound calls","Spend your time on the problem, not the plumbing"], art:"px-c11-stack.png", artW:450, artH:460 },
  { kicker:"WHAT YOU'LL BUILD ON — 2/3", l1:"memory, docs &<br>whatsapp", body:["<b>Memory & knowledge base</b> — your agent remembers callers and answers from your own docs","<b>WhatsApp follow-ups</b> — instant post-call messages & callback requests, no Meta setup needed"], art:"px-c12-memory.png", artW:450, artH:440 },
  { kicker:"WHAT YOU'LL BUILD ON — 3/3", l1:"automation &<br>squad agents", body:["<b>Website & Google Sheets automation</b> — connect a form or spreadsheet, your agent starts calling","<b>Squad agents</b> — a team of agents that hand off a live call to each other"], art:"px-c13-squad.png", artW:470, artH:430 },
  { kicker:"THE POINT", l1:"not a chatbot<br>with a voice", body:["You're building something that runs a <b>real business workflow over the phone</b>","300 builders. One hall. One day."], art:"px-c14-crowd.png", artW:620, artH:500 },
  { kicker:"SEE YOU THERE", l1:"register<br>now", l2:"for Tamil Nadu", body:["Sat, Sep 5 · 9:30 AM – 6:00 PM","Olive Public School, Chitlapakkam, Chennai","Free Entry · Solo or Teams of 2–3 · <b>AI குரல்</b>"], art:"px-c15-cheer.png", artW:460, artH:400, logos:true, cta:"LINK IN BIO" },
];

const bunting = `<div class="bunting"><div style="background:#8E2A5C"></div><div style="background:#C99A1F"></div><div style="background:#12406B"></div><div style="background:#256B4A"></div><div style="background:#F04E23"></div><div style="background:#8E2A5C"></div><div style="background:#C99A1F"></div><div style="background:#12406B"></div><div style="background:#256B4A"></div><div style="background:#F04E23"></div><div style="background:#8E2A5C"></div><div style="background:#C99A1F"></div><div style="background:#12406B"></div><div style="background:#256B4A"></div><div style="background:#F04E23"></div></div>`;

const logosHtml = `<div class="logos">
  <div class="lg"><span>ORGANISED BY</span><span class="sscol"><img class="ss" src="snapserve-logo-t.png"><em>powered by sarvam</em></span></div>
  <div class="lg"><span>POWERED BY</span><img src="vobiz-logo.png"></div>
  <div class="lg"><span>SUPPORTED BY</span><img src="zenxai-logo.png"></div>
</div>`;

slides.forEach((s, i) => {
  const n = i + 1, total = slides.length;
  const pg = String(n).padStart(2, "0") + " / " + String(total).padStart(2, "0");
  const runFooter = logosHtml;
  const body = s.body.map(b => `<div class="li"><span class="dot"></span><span>${b}</span></div>`).join("");
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Space+Mono:wght@400;700&family=Playfair+Display:wght@700&family=Noto+Sans+Tamil:wght@600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1080px;overflow:hidden}
body{font-family:'Inter',sans-serif;background:#fff;color:#131313;position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(#F0EDE6 1px,transparent 1px),linear-gradient(90deg,#F0EDE6 1px,transparent 1px);background-size:54px 54px;opacity:.6}
.bunting{position:relative;display:flex;height:24px}.bunting div{flex:1}
.wrap{position:relative;padding:0 76px;z-index:2}
.top{display:flex;justify-content:space-between;align-items:center;font-family:'Space Mono',monospace;font-size:17px;font-weight:700;letter-spacing:.09em;margin-top:32px}
.top .pg{color:#F04E23}
.l1{font-weight:800;font-size:84px;letter-spacing:-.035em;line-height:1.02;margin-top:56px}
.l2{font-family:'Playfair Display';font-style:italic;font-weight:700;font-size:50px;color:#F04E23;margin-top:10px}
.big{display:inline-block;background:#1B2A5E;color:#fff;font-family:'Space Mono',monospace;font-weight:700;font-size:24px;letter-spacing:.08em;padding:18px 34px;margin-top:44px}
.body{margin-top:44px;max-width:560px}
.li{display:flex;gap:16px;font-size:24px;font-weight:600;color:#444;line-height:1.5;margin-top:22px}
.li b{color:#131313}
.dot{flex:none;width:14px;height:14px;background:#F04E23;margin-top:11px}
.cta{display:inline-block;background:#1B2A5E;color:#fff;font-weight:800;font-size:18px;letter-spacing:.14em;padding:17px 46px;margin-top:40px}
.art{position:absolute;right:20px;bottom:110px;width:${s.artW}px;height:${s.artH}px;background:url(art/${s.art}) right bottom/contain no-repeat}
.run{position:absolute;left:76px;right:76px;bottom:30px;display:flex;justify-content:space-between;border-top:2px solid #131313;padding-top:16px;font-family:'Space Mono',monospace;font-size:14px;letter-spacing:.09em;color:#777}
.logos{position:absolute;left:76px;right:76px;bottom:26px;display:flex;justify-content:space-between;align-items:center;border-top:2px solid #131313;padding-top:16px}
.lg{display:flex;align-items:center;gap:10px}
.lg span{font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.1em;color:#777}
.lg img{height:38px}.lg img.ss{height:50px}
.sscol{display:flex;flex-direction:column;align-items:flex-start;gap:2px}.sscol em{font-style:normal;font-family:Space Mono,monospace;font-size:12px;letter-spacing:.06em;color:#B4531F}
.tamil{font-family:'Noto Sans Tamil',sans-serif}
</style></head><body>
<div class="grid"></div>
${bunting}
<div class="wrap">
  <div class="top"><span>${s.kicker}</span><span class="pg">${pg}</span></div>
  <div class="l1">${s.l1}</div>
  ${s.l2 ? `<div class="l2">${s.l2}</div>` : ""}
  ${s.big ? `<div class="big">${s.big}</div>` : ""}
  ${body ? `<div class="body">${body}</div>` : ""}
  ${s.cta ? `<div class="cta">${s.cta}</div>` : ""}
</div>
<div class="art"></div>
${runFooter}
</body></html>`;
  writeFileSync(new URL(`./c${n}.html`, import.meta.url), html);
});
console.log("wrote", slides.length, "slides");
