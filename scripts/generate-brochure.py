from fpdf import FPDF
from fpdf.enums import XPos, YPos
import os

OUTPUT  = "artifacts/snapserve-book/public/brochure/snapserve-brochure.pdf"
LOGO    = "artifacts/snapserve-book/public/brochure/snapserve-logo.png"

BRAND  = (108, 99, 255)
ACCENT = ( 16,185,129)
DARK   = ( 15, 15, 26)
DARK2  = ( 30, 30, 53)
WHITE  = (255,255,255)
LBG    = (248,250,252)
BORDER = (226,232,240)
TEXT   = ( 15, 23, 42)
MUTED  = (100,116,139)
ORANGE = (245,158, 11)
RED    = (239, 68, 68)
GOLD   = (251,191, 36)

class B(FPDF):
    def header(self): pass
    def footer(self): pass

    def fr(self, x, y, w, h, r, g, b):
        self.set_fill_color(r,g,b); self.set_draw_color(r,g,b)
        self.rect(x,y,w,h,"F")

    def frd(self, x, y, w, h, fr,fg,fb, br,bg2,bb):
        self.set_fill_color(fr,fg,fb); self.set_draw_color(br,bg2,bb)
        self.rect(x,y,w,h,"FD")

    def logo_block(self, x, y, size=22):
        # use the real logo image
        try:
            self.image(LOGO, x, y, size, size)
        except Exception:
            self.fr(x, y, size, size, *BRAND)
            self.set_font("Helvetica","B",int(size*0.55))
            self.set_text_color(*WHITE)
            self.set_xy(x,y); self.cell(size,size,"S",align="C")

    def header_bar(self, page_num, total=7):
        self.fr(0,0,210,14,*DARK)
        # logo thumbnail
        try:
            self.image(LOGO, 8, 1.5, 11, 11)
        except Exception:
            self.fr(8,1.5,11,11,*BRAND)
        self.set_font("Helvetica","B",9); self.set_text_color(*WHITE)
        self.set_xy(22,3.5); self.cell(0,7,"SnapServe  -  AI Voice Platform",new_x=XPos.LMARGIN)
        self.set_font("Helvetica","",8); self.set_text_color(*MUTED)
        self.set_xy(22,3.5); self.cell(178,7,f"Page {page_num} of {total}",align="R")

    def footer_bar(self):
        self.set_draw_color(*BORDER); self.line(10,282,200,282)
        self.set_font("Helvetica","",7.5); self.set_text_color(*MUTED)
        self.set_xy(10,283); self.cell(0,5,"(c) 2026 SnapServe.  All rights reserved.  Confidential.",new_x=XPos.LMARGIN)
        self.set_xy(10,283); self.cell(190,5,"snapserve.ai",align="R")

    def eyebrow(self,x,y,text):
        self.set_font("Helvetica","B",8); self.set_text_color(*BRAND)
        self.set_xy(x,y); self.cell(0,5,text.upper())

    def stitle(self,x,y,text,size=18):
        self.set_font("Helvetica","B",size); self.set_text_color(*TEXT)
        self.set_xy(x,y); self.cell(0,8,text)

    def body(self,x,y,w,text,size=9.5):
        self.set_font("Helvetica","",size); self.set_text_color(*MUTED)
        self.set_xy(x,y); self.multi_cell(w,5,text)

    def dark_band(self,x,y,w,h):
        self.fr(x,y,w,h,*DARK)

    def feat_card(self,x,y,w,h,tag,title,desc,accent=False):
        bg=(240,244,255) if accent else LBG
        bc=(199,210,254) if accent else BORDER
        self.frd(x,y,w,h,*bg,*bc)
        self.fr(x+5,y+5,14,12,*(199,210,254) if accent else (226,232,240))
        self.set_font("Helvetica","B",6.5)
        self.set_text_color(*BRAND if accent else TEXT)
        self.set_xy(x+5,y+6); self.cell(14,9,tag,align="C")
        self.set_font("Helvetica","B",8.5); self.set_text_color(*TEXT)
        self.set_xy(x+5,y+20); self.cell(w-10,5,title)
        self.set_font("Helvetica","",7.5); self.set_text_color(*MUTED)
        self.set_xy(x+5,y+27); self.multi_cell(w-10,4.3,desc)

    def badge(self,x,y,text,bg,fg,w=None):
        self.set_font("Helvetica","B",7)
        tw=w if w else self.get_string_width(text)+10
        self.set_fill_color(*bg); self.rect(x,y,tw,7,"F")
        self.set_text_color(*fg); self.set_xy(x,y+0.5); self.cell(tw,6,text,align="C")
        return tw+3


pdf = B(orientation="P",unit="mm",format="A4")
pdf.set_auto_page_break(False)
pdf.set_margins(0,0,0)

# ══════════════════════════════════════════════════════════════════════════════
# PAGE 1 — COVER
# ══════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.fr(0,0,210,297,*DARK)
pdf.fr(0,0,210,5,*BRAND)            # top accent bar

# logo + name
pdf.logo_block(12,16,28)
pdf.set_font("Helvetica","B",18); pdf.set_text_color(*WHITE)
pdf.set_xy(44,19); pdf.cell(0,8,"SnapServe")
pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
pdf.set_xy(44,28); pdf.cell(0,5,"AI VOICE PLATFORM")

# top-right badge
pdf.fr(148,16,52,10,30,30,80)
pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(165,180,252)
pdf.set_xy(148,16); pdf.cell(52,10,"Product Brochure  2026",align="C")

# eyebrow
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*ACCENT)
pdf.set_xy(10,78); pdf.cell(190,6,"ENTERPRISE AI VOICE AGENTS",align="C")

# main title
pdf.set_font("Helvetica","B",40); pdf.set_text_color(*WHITE)
pdf.set_xy(10,87); pdf.cell(190,18,"Your Business,",align="C")
pdf.set_text_color(*BRAND)
pdf.set_xy(10,105); pdf.cell(190,18,"Speaking Smarter.",align="C")

# subtitle
pdf.set_font("Helvetica","",12); pdf.set_text_color(148,163,184)
pdf.set_xy(25,129)
pdf.multi_cell(160,6.5,
    "SnapServe is an AI voice agent orchestration platform that lets you deploy\n"
    "intelligent, multilingual voice agents in minutes - no engineering team required.")

# feature pills
pills=["Auto-Dial Campaigns","Caller Memory","Custom SnapServe Voices",
       "Multilingual STT","Any Telephony","Smart Scheduling"]
px=12
for p in pills:
    pdf.set_font("Helvetica","B",7)
    tw=pdf.get_string_width(p)+12
    if px+tw>198: px=12; # wrap
    pdf.fr(px,157,tw,9,40,40,70)
    pdf.set_text_color(203,213,225)
    pdf.set_xy(px,157.5); pdf.cell(tw,8,p,align="C")
    px+=tw+4

# stats strip
stats=[("$0.05/min","Fully Managed"),("Auto-Dial","Outbound Campaigns"),
       ("10+","AI Providers"),("4+","Telephony Providers")]
bx=10
sw=47
for val,lbl in stats:
    pdf.fr(bx,182,sw,34,22,22,40)
    pdf.set_font("Helvetica","B",15); pdf.set_text_color(*WHITE)
    pdf.set_xy(bx,188); pdf.cell(sw,8,val,align="C")
    pdf.set_font("Helvetica","",7); pdf.set_text_color(*MUTED)
    pdf.set_xy(bx,197); pdf.cell(sw,5,lbl,align="C")
    bx+=sw+3

# Exclusive banner
pdf.fr(10,224,190,22,20,18,50)
pdf.set_draw_color(*BRAND); pdf.rect(10,224,190,22,"D")
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*GOLD)
pdf.set_xy(18,228)
pdf.cell(0,5,"EXCLUSIVE:  SnapServe Custom Voices")
pdf.set_font("Helvetica","",8); pdf.set_text_color(203,213,225)
pdf.set_xy(18,235)
pdf.cell(0,5,"Proprietary AI voices trained for Indian accents - not available on any other platform.")

pdf.set_draw_color(40,40,70); pdf.line(10,264,200,264)
pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
pdf.set_xy(10,266); pdf.cell(0,5,"Confidential - For Client Use Only - 2026")
pdf.set_text_color(*BRAND); pdf.set_xy(10,266); pdf.cell(190,5,"snapserve.ai",align="R")


# ══════════════════════════════════════════════════════════════════════════════
# PAGE 2 — CORE PLATFORM FEATURES
# ══════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.header_bar(2)
pdf.eyebrow(12,20,"Platform Features")
pdf.stitle(12,27,"What SnapServe Delivers")
pdf.body(12,38,186,
    "SnapServe is a full-stack AI voice orchestration platform - from the moment the phone rings to the "
    "post-call memory update. Every feature is built-in, not bolted on.")

cards=[
    ("AUTO","Auto-Dial Campaigns",
     "Upload a lead list, set concurrency and go. SnapServe auto-dials, handles answering machines, retries failed calls and tracks every outcome.",True),
    ("MEM","Outbound + Caller Memory",
     "Every outbound call is memory-aware. The agent remembers past conversations, so it picks up exactly where it left off on every retry.",False),
    ("VOICE","SnapServe Custom Voices",
     "Proprietary AI voices trained for Indian English, Hindi and Indic languages - richer, more natural and not available on any other platform.",True),
    ("AMD","Voicemail / AMD Detection",
     "Automatically detects answering machines and voicemails before connecting your agent, saving minutes and improving answer-rate accuracy.",False),
    ("XFER","Warm Transfer",
     "Agent hands the call to a human agent with a live spoken briefing - the operator hears full context before the caller is connected.",False),
    ("BARGE","Barge-In Detection",
     "Callers can interrupt the agent mid-sentence naturally. No awkward silences, no waiting for the agent to finish. Truly conversational.",False),
    ("GEND","Gender Detection",
     "Detects caller gender in real time and automatically adjusts the Sir/Ma'am salutation - personalised from the very first greeting.",False),
    ("KB","Knowledge Base",
     "Attach product manuals, FAQs, scripts or policies. The agent answers questions from your content using full-text search at call time.",False),
    ("SCHED","Smart Scheduling",
     "Built-in booking engine: availability calendars, Google Calendar sync, slot locking and automatic email/webhook notifications.",False),
    ("CAMP","Campaign Management",
     "Full campaign dashboard: batches, concurrency control, pacing, retry logic, lead status tracking and live call-by-call reporting.",False),
    ("CRM","CRM & Webhooks",
     "Push call events, transcripts and outcomes to HubSpot, Zoho, Salesforce or any webhook endpoint in real time after every call.",False),
    ("WEB","Web Call Widget",
     "Embed a browser-based call button on your website. Visitors talk to your AI agent directly - zero telephony setup for the end user.",False),
]
col_w=91; row_h=46; mx=12; my=56
for i,(tag,title,desc,acc) in enumerate(cards):
    col=i%2; row=i//2
    cx=mx+col*(col_w+4); cy=my+row*(row_h+4)
    pdf.feat_card(cx,cy,col_w,row_h,tag,title,desc,acc)

pdf.footer_bar()


# ══════════════════════════════════════════════════════════════════════════════
# PAGE 3 — SNAPSERVE EXCLUSIVE: CUSTOM VOICES
# ══════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.header_bar(3)
pdf.eyebrow(12,20,"Exclusive Feature")

# Gold headline banner
pdf.fr(12,28,186,14,25,22,10)
pdf.set_draw_color(*GOLD); pdf.rect(12,28,186,14,"D")
pdf.set_font("Helvetica","B",13); pdf.set_text_color(*GOLD)
pdf.set_xy(12,29); pdf.cell(186,12,"SnapServe Custom Voices - Not Available Anywhere Else",align="C")

pdf.body(12,48,186,
    "While other platforms route your calls through generic ElevenLabs or OpenAI TTS voices shared by thousands "
    "of businesses, SnapServe offers a library of proprietary AI voices - trained specifically for Indian English "
    "and Indic language callers. These voices are exclusive to the SnapServe platform.")

# Voice feature cards
voice_feats=[
    ("Indian English Accent","Voices trained on native Indian English speech patterns - not a generic American or British voice that sounds out of place to Indian callers."),
    ("Indic Language Voices","Dedicated voices for Hindi, Tamil, Telugu, Malayalam and more - natural prosody, correct pronunciation and regional nuance built in."),
    ("Custom Brand Voice","Commission a voice trained on your brand persona. Your AI agent sounds exactly the way your brand wants to sound - no one else has that voice."),
    ("Low Latency Streaming","SnapServe voices stream the first audio chunk in under 300 ms - faster than any third-party TTS integration, keeping conversations fluid."),
    ("Emotion-Aware Tone","The voice adapts tone and pace based on conversation context - warmer for greetings, clearer for confirmations, calm for objection handling."),
    ("No Provider Lock-In Risk","Because SnapServe owns these voices, there is no risk of a third-party provider changing pricing, deprecating a voice or going offline."),
]
vx,vy,vw,vh=12,82,88,38
for i,(vt,vd) in enumerate(voice_feats):
    col=i%2; row=i//2
    cx=vx+col*(vw+4); cy=vy+row*(vh+5)
    pdf.fr(cx,cy,vw,vh,20,18,50)
    pdf.set_draw_color(*BRAND); pdf.rect(cx,cy,vw,vh,"D")
    # gold accent bar on left
    pdf.fr(cx,cy,3,vh,*GOLD)
    pdf.set_font("Helvetica","B",8.5); pdf.set_text_color(*WHITE)
    pdf.set_xy(cx+7,cy+5); pdf.cell(vw-12,5,vt)
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(148,163,184)
    pdf.set_xy(cx+7,cy+13); pdf.multi_cell(vw-12,4.2,vd)

# Comparison callout
cmp_y=vy+3*(vh+5)+6
pdf.dark_band(12,cmp_y,186,52)
pdf.set_font("Helvetica","B",11); pdf.set_text_color(*WHITE)
pdf.set_xy(20,cmp_y+7); pdf.cell(0,6,"How SnapServe Voices Compare")

col_hdr=["",  "SnapServe Voices","ElevenLabs","OpenAI TTS","Azure Neural"]
col_wv= [54,   36,                 36,           36,          24]
rows_v=[
    ("Indian accent quality",   "Excellent",  "Generic",   "Generic",  "Basic"),
    ("Indic language prosody",  "Native",     "Limited",   "Limited",  "Limited"),
    ("Custom brand voice",      "Yes",        "Paid extra","No",       "No"),
    ("Exclusive to you",        "Yes",        "No",        "No",       "No"),
    ("Latency (first chunk)",   "< 300 ms",   "400-600ms", "300-500ms","400ms+"),
]
thy=cmp_y+16
thx=20
for hi,(hdr,hw) in enumerate(zip(col_hdr,col_wv)):
    bg=BRAND if hi==1 else (30,28,60)
    tc=WHITE if hi>=1 else MUTED
    pdf.set_fill_color(*bg); pdf.set_draw_color(40,40,70)
    pdf.rect(thx,thy,hw,7,"FD")
    pdf.set_font("Helvetica","B",6.5); pdf.set_text_color(*tc)
    pdf.set_xy(thx+1,thy+0.8); pdf.cell(hw-2,5.5,hdr,align="C" if hi>0 else "L")
    thx+=hw
thy+=7
for ri,row in enumerate(rows_v):
    thx=20; bg=(22,20,50) if ri%2==0 else (18,16,42)
    for ci,(cell,cw) in enumerate(zip(row,col_wv)):
        cbg=(25,22,58) if ci==1 else bg
        pdf.set_fill_color(*cbg); pdf.set_draw_color(40,40,70)
        pdf.rect(thx,thy,cw,7,"FD")
        if ci==1: tc=BRAND
        elif cell in("Excellent","Native","Yes","< 300 ms"): tc=ACCENT
        elif cell in("Generic","Limited","No","Paid extra"): tc=RED
        else: tc=(180,180,200)
        pdf.set_font("Helvetica","B" if ci<=1 else "",7); pdf.set_text_color(*tc)
        pdf.set_xy(thx+1,thy+1); pdf.cell(cw-2,5,cell,align="C" if ci>0 else "L")
        thx+=cw
    thy+=7

pdf.footer_bar()


# ══════════════════════════════════════════════════════════════════════════════
# PAGE 4 — HOW IT WORKS
# ══════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.header_bar(4)
pdf.eyebrow(12,20,"Architecture")
pdf.stitle(12,27,"How It Works")
pdf.body(12,38,186,
    "Every call flows through SnapServe's real-time orchestration pipeline - from the first ring to post-call memory update.")

# arch band
pdf.dark_band(12,52,186,70)
nodes=[("Caller",""),("Telephony","Twilio/Plivo\nVoBiz"),("SnapServe","\nCore"),
       ("ASR","Speech\nto Text"),("LLM","AI\nBrain"),("TTS","Text\nto Voice"),("Caller","")]
nw=24; gap=3; nx=14
for j,(nd,sub) in enumerate(nodes):
    is_core=nd=="SnapServe"
    bc=BRAND if is_core else (42,42,69)
    pdf.fr(nx,55,nw,20,*bc)
    if is_core:
        pdf.set_draw_color(*BRAND); pdf.rect(nx,55,nw,20,"D")
    pdf.set_font("Helvetica","B" if is_core else "",7)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(nx,59); pdf.cell(nw,5,nd,align="C")
    if sub.strip():
        lines=sub.strip().split("\n")
        for li,ln in enumerate(lines):
            pdf.set_font("Helvetica","",5.5); pdf.set_text_color(148,163,184)
            pdf.set_xy(nx,64+li*4); pdf.cell(nw,4,ln,align="C")
    if j<len(nodes)-1:
        pdf.set_font("Helvetica","B",9); pdf.set_text_color(*BRAND)
        pdf.set_xy(nx+nw,57); pdf.cell(gap,8,">",align="C")
    nx+=nw+gap

# provider rows
prov_rows=[
    ("STT:",["Deepgram","Azure","Whisper","Sarvam"]),
    ("LLM:",["OpenAI","Anthropic","DeepSeek","Mistral","Cohere"]),
    ("TTS:",["SnapServe Custom","ElevenLabs","OpenAI","AWS Polly","Azure","Cartesia"]),
    ("TEL:",["Twilio","Plivo","VoBiz","Vonage"]),
]
pry=78
for pr_lbl,pr_chips in prov_rows:
    pdf.set_font("Helvetica","B",6.5); pdf.set_text_color(*BRAND)
    pdf.set_xy(14,pry); pdf.cell(10,5,pr_lbl)
    cx_p=26
    for chip in pr_chips:
        is_snap="SnapServe" in chip
        bg=BRAND if is_snap else (35,35,62)
        tc=WHITE if is_snap else (148,163,184)
        pdf.set_font("Helvetica","B" if is_snap else "",5.8)
        tw=pdf.get_string_width(chip)+7
        pdf.fr(cx_p,pry+0.5,tw,5,*bg)
        pdf.set_text_color(*tc)
        pdf.set_xy(cx_p,pry+0.5); pdf.cell(tw,5,chip,align="C")
        cx_p+=tw+3
    pry+=7

steps=[
    ("1","Call Arrives",
     "TCN / Twilio / Plivo dials the lead. On answer, the telephony provider routes the live call to SnapServe via webhook + WebSocket audio stream."),
    ("2","AMD Check",
     "SnapServe's Answering Machine Detection (AMD) identifies if a voicemail or machine answered. Live-answer calls proceed; machines are handled separately."),
    ("3","Greeting + Gender Detection",
     "The agent plays its custom greeting. Simultaneously, SnapServe analyses the caller's first words to detect gender and auto-personalise the Sir/Ma'am salutation."),
    ("4","STT + Memory Lookup",
     "Caller speech is transcribed in real time. SnapServe looks up the caller's history, facts and prior conversation context from Caller Memory."),
    ("5","LLM Decision",
     "The full context - transcript, memory, system prompt, tools - is sent to the LLM. The AI decides what to say, what to look up, whether to book or transfer."),
    ("6","TTS Response",
     "The LLM reply is streamed to SnapServe's custom TTS engine. The first audio chunk reaches the caller in under 300 ms. Barge-in detection stays active throughout."),
    ("7","Post-Call Memory Update",
     "After the call ends, SnapServe summarises the conversation, updates caller facts, logs the outcome and triggers webhooks / CRM integrations automatically."),
]
sy=128
for sn,st,sd in steps:
    pdf.set_fill_color(*BRAND); pdf.set_draw_color(*BRAND)
    pdf.ellipse(12,sy,8,8,"F")
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*WHITE)
    pdf.set_xy(12,sy+0.8); pdf.cell(8,6.5,sn,align="C")
    if sn!="7": pdf.set_draw_color(*BRAND); pdf.line(16,sy+8,16,sy+20)
    pdf.set_font("Helvetica","B",9); pdf.set_text_color(*TEXT)
    pdf.set_xy(25,sy+0.2); pdf.cell(0,5,st)
    pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
    pdf.set_xy(25,sy+5.8); pdf.multi_cell(170,4,sd)
    sy+=21

pdf.footer_bar()


# ══════════════════════════════════════════════════════════════════════════════
# PAGE 5 — USE CASES
# ══════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.header_bar(5)
pdf.eyebrow(12,20,"Applications")
pdf.stitle(12,27,"Who Uses SnapServe?")
pdf.body(12,38,186,
    "From BFSI collections to EdTech admissions, SnapServe powers voice agents across every industry that calls customers at scale.")

use_cases=[
    ("BFSI","Banking & Finance","Loan follow-up, EMI reminders, KYC collection, balance enquiry, payment confirmations, fraud alerts."),
    ("HLTH","Healthcare","Appointment booking, prescription reminders, lab result notifications, discharge follow-ups, patient engagement."),
    ("ECOM","E-Commerce","Order status, delivery confirmations, return initiations, COD verification, post-purchase satisfaction calls."),
    ("REAL","Real Estate","Lead qualification, site visit scheduling, property inquiry handling, NRI investor outreach, follow-up automation."),
    ("TELCO","Telecom & Utilities","Outage notifications, bill payment reminders, plan upgrade offers, service renewal, complaint triage."),
    ("EDTCH","EdTech","Admission follow-up, class reminders, parent-teacher communication, fee collection, student support."),
    ("AUTO","Automotive","Test drive scheduling, service reminders, insurance renewal, EMI follow-up, post-service NPS calls."),
    ("INSUR","Insurance","Policy renewal reminders, claim status updates, premium collection, TATA/LIC-style outbound servicing."),
    ("COLL","Collections & Sales","Predictive outbound dialing, lead scoring by conversation outcome, hot-lead warm transfer to human closers."),
]
cxu,cyu,cwu,chu=12,56,58,44
for i,(ico,title,desc) in enumerate(use_cases):
    col=i%3; row=i//3
    cx=cxu+col*(cwu+4); cy=cyu+row*(chu+4)
    pdf.frd(cx,cy,cwu,chu,*LBG,*BORDER)
    pdf.fr(cx+cwu/2-7,cy+4,14,11,*BORDER)
    pdf.set_font("Helvetica","B",6); pdf.set_text_color(*BRAND)
    pdf.set_xy(cx+cwu/2-7,cy+5.2); pdf.cell(14,8,ico,align="C")
    pdf.set_font("Helvetica","B",8); pdf.set_text_color(*TEXT)
    pdf.set_xy(cx+4,cy+17); pdf.cell(cwu-8,5,title,align="C")
    pdf.set_font("Helvetica","",7); pdf.set_text_color(*MUTED)
    pdf.set_xy(cx+3,cy+23); pdf.multi_cell(cwu-6,3.8,desc)

mby=cyu+3*(chu+4)+4
pdf.dark_band(12,mby,186,46)
pdf.set_font("Helvetica","B",12); pdf.set_text_color(*WHITE)
pdf.set_xy(20,mby+6); pdf.cell(0,7,"Built for Multilingual India")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(148,163,184)
pdf.set_xy(20,mby+14)
pdf.multi_cell(170,5,
    "SnapServe agents speak and understand Hindi, Tamil, Telugu, Malayalam, Kannada, Marathi, Bengali and Indian English - "
    "switching languages mid-call based on the caller's preference. The SnapServe Custom Voices are trained on native "
    "Indian speech patterns, giving your agents an accent your customers actually trust.")
langs=["Hindi","Tamil","Telugu","Malayalam","Kannada","Marathi","Bengali","English"]
lx=20
for lang in langs:
    pdf.set_font("Helvetica","B",7)
    tw=pdf.get_string_width(lang)+10
    pdf.fr(lx,mby+36,tw,7,40,40,70)
    pdf.set_text_color(203,213,225)
    pdf.set_xy(lx,mby+36.5); pdf.cell(tw,6,lang,align="C")
    lx+=tw+4

pdf.footer_bar()


# ══════════════════════════════════════════════════════════════════════════════
# PAGE 6 — PRICING
# ══════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.header_bar(6)
pdf.eyebrow(12,20,"Pricing")
pdf.stitle(12,27,"Simple, Transparent Pricing")
pdf.body(12,38,186,"Two plans. No hidden fees. No per-seat charges. Pay only for what your agents actually use.")

# Managed card
pdf.frd(12,52,88,114,*LBG,*BORDER)
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*BRAND)
pdf.set_xy(20,59); pdf.cell(0,5,"MANAGED PLAN")
pdf.set_font("Helvetica","B",30); pdf.set_text_color(*TEXT)
pdf.set_xy(20,66); pdf.cell(0,13,"$0.05")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(*MUTED)
pdf.set_xy(20,80); pdf.cell(0,5,"per minute - all-inclusive")
pdf.set_font("Helvetica","",8); pdf.set_text_color(55,65,81)
pdf.set_xy(20,88); pdf.multi_cell(72,4.8,
    "We supply all AI provider keys - ASR, LLM and TTS. You just configure your agents and go live.")
feats_m=["All AI providers included","No API keys to manage",
         "SnapServe Custom Voices included","Auto-Dial campaigns",
         "Caller memory across calls","Smart scheduling built-in",
         "$5 free credits on sign-up","Full analytics & CRM webhooks"]
fy=111
for f in feats_m:
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*ACCENT)
    pdf.set_xy(20,fy); pdf.cell(6,4.8,"v")
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(*TEXT)
    pdf.set_xy(26,fy); pdf.cell(0,4.8,f)
    fy+=6

# BYOP card
pdf.fr(108,52,92,114,*DARK2)
pdf.set_draw_color(*BRAND); pdf.rect(108,52,92,114,"D")
pdf.fr(136,52,64,9,*ACCENT)
pdf.set_font("Helvetica","B",7); pdf.set_text_color(*WHITE)
pdf.set_xy(136,53); pdf.cell(64,7,"MOST POPULAR - BEST VALUE",align="C")
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*ACCENT)
pdf.set_xy(116,65); pdf.cell(0,5,"BYOP PLAN")
pdf.set_font("Helvetica","B",30); pdf.set_text_color(*WHITE)
pdf.set_xy(116,72); pdf.cell(0,13,"$0.035")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(*MUTED)
pdf.set_xy(116,86); pdf.cell(0,5,"per minute - orchestration only")
pdf.set_font("Helvetica","",8); pdf.set_text_color(148,163,184)
pdf.set_xy(116,94); pdf.multi_cell(76,4.8,
    "Bring your own API keys. Pay SnapServe only for orchestration. Best for high-volume deployments.")
feats_b=["Your own ASR / LLM / TTS keys","Lower per-minute cost",
         "SnapServe Custom Voices available","Auto-Dial campaigns",
         "Caller memory across calls","Smart scheduling built-in",
         "Full analytics & CRM webhooks","Ideal for 1000+ min/day"]
fy=117
for f in feats_b:
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*ACCENT)
    pdf.set_xy(116,fy); pdf.cell(6,4.8,"v")
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(203,213,225)
    pdf.set_xy(122,fy); pdf.cell(0,4.8,f)
    fy+=6

# Cost guide
pdf.frd(12,174,186,44,*LBG,*BORDER)
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*TEXT)
pdf.set_xy(20,180); pdf.cell(0,5,"Which plan is right for you?")
m_tips=["Just getting started","Don't want to manage API keys",
        "Low-medium call volume","Want fastest go-live"]
b_tips=["High call volumes (1000+ min/day)","Have existing provider contracts",
        "Want to optimise per-minute cost","Need specific provider features"]
pdf.set_font("Helvetica","B",8); pdf.set_text_color(*BRAND)
pdf.set_xy(20,188); pdf.cell(0,5,"Choose Managed if...")
pdf.set_font("Helvetica","B",8); pdf.set_text_color(*ACCENT)
pdf.set_xy(112,188); pdf.cell(0,5,"Choose BYOP if...")
for ti,tip in enumerate(m_tips):
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(20,195+ti*5); pdf.cell(0,5,"- "+tip)
for ti,tip in enumerate(b_tips):
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(112,195+ti*5); pdf.cell(0,5,"- "+tip)

# free trial
pdf.frd(12,225,186,20,240,253,244,167,243,208)
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*ACCENT)
pdf.set_xy(20,231); pdf.cell(0,5,"Free Trial:  $5 of call credits (~100 minutes) on every new account.  No credit card required.")
pdf.set_font("Helvetica","",8); pdf.set_text_color(55,65,81)
pdf.set_xy(20,237); pdf.cell(0,5,"Top up your wallet at any time. Cancel or change plans whenever you like.")

pdf.footer_bar()


# ══════════════════════════════════════════════════════════════════════════════
# PAGE 7 — PROVIDERS, COMPARISON & CONTACT
# ══════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.header_bar(7)
pdf.eyebrow(12,20,"Integrations & Comparison")
pdf.stitle(12,27,"Supported Providers")

prov=[
    ("STT (Speech-to-Text)",BRAND,[(108,99,255),"Deepgram","Azure Speech","OpenAI Whisper","Sarvam AI"]),
    ("LLM Models",ACCENT,[(16,185,129),"OpenAI GPT-4o","Anthropic Claude","DeepSeek","Mistral","Cohere","Groq"]),
    ("TTS (Text-to-Speech)",ORANGE,[(245,158,11),"SnapServe Custom","ElevenLabs","OpenAI TTS","AWS Polly","Azure Neural","Cartesia","Deepgram Aura"]),
    ("Telephony",RED,[(239,68,68),"Twilio","Plivo","VoBiz","Vonage"]),
]
py=42
for sec_t,_,chips in prov:
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(12,py); pdf.cell(0,5,sec_t.upper())
    py+=6
    dot_c=chips[0]; labels=chips[1:]
    cx_c=12
    for label in labels:
        is_snap="SnapServe" in label
        pdf.set_font("Helvetica","B" if is_snap else "",7.5)
        tw=pdf.get_string_width(label)+14
        if is_snap:
            pdf.fr(cx_c,py,tw,8,*BRAND)
            pdf.set_text_color(*WHITE)
        else:
            pdf.frd(cx_c,py,tw,8,*LBG,*BORDER)
            pdf.set_fill_color(*dot_c); pdf.set_draw_color(*dot_c)
            pdf.ellipse(cx_c+3.5,py+2.7,2.8,2.8,"F")
            pdf.set_text_color(*TEXT)
        xoff=8 if not is_snap else 4
        pdf.set_xy(cx_c+xoff,py+0.6); pdf.cell(tw-xoff-2,7,label)
        cx_c+=tw+3
        if cx_c>172: cx_c=12; py+=10
    py+=12

# Comparison
pdf.eyebrow(12,py,"Comparison"); py+=6
pdf.set_font("Helvetica","B",12); pdf.set_text_color(*TEXT)
pdf.set_xy(12,py); pdf.cell(0,6,"SnapServe vs. Alternatives"); py+=8

cols_w=[60,34,32,30,30]
hdrs=["Feature","SnapServe","Vapi","Bolna","Custom Build"]
hx=12
for hi,(hdr,hw) in enumerate(zip(hdrs,cols_w)):
    bg=BRAND if hi==1 else (248,250,252)
    tc=WHITE if hi==1 else TEXT
    pdf.set_fill_color(*bg); pdf.set_draw_color(*BORDER)
    pdf.rect(hx,py,hw,9,"FD")
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*tc)
    pdf.set_xy(hx+2,py+1.5); pdf.cell(hw-4,6,hdr,align="C" if hi>0 else "L")
    hx+=hw

rows=[
    ("Custom/Indic voices",     "Yes - Own voices","No","No","DIY"),
    ("Auto-Dial campaigns",     "Yes - Built-in","Basic","No","DIY"),
    ("Caller memory",           "Yes - Built-in","No","No","DIY"),
    ("AMD detection",           "Yes","Limited","No","DIY"),
    ("Gender salutation",       "Yes","No","No","No"),
    ("Warm transfer",           "Yes","Yes","No","DIY"),
    ("Scheduling / Booking",    "Yes - Full","No","No","DIY"),
    ("Multilingual Indic STT",  "Yes - Full","Limited","Yes","DIY"),
    ("BYOP provider keys",      "Yes","Yes","Yes","Yes"),
    ("Setup time",              "< 10 min","< 10 min","Hours","Weeks"),
]
py+=9
for ri,row in enumerate(rows):
    bg=(250,250,255) if ri%2==0 else WHITE
    hx2=12
    for ci,(cell,cw) in enumerate(zip(row,cols_w)):
        cbg=(245,243,255) if ci==1 else bg
        pdf.set_fill_color(*cbg); pdf.set_draw_color(*BORDER)
        pdf.rect(hx2,py,cw,7.5,"FD")
        if ci==1: tc=BRAND
        elif cell.startswith("Yes"): tc=ACCENT
        elif cell=="No": tc=RED
        else: tc=TEXT
        pdf.set_font("Helvetica","B" if ci<=1 else "",7); pdf.set_text_color(*tc)
        pdf.set_xy(hx2+2,py+1); pdf.cell(cw-4,5.5,cell,align="C" if ci>0 else "L")
        hx2+=cw
    py+=7.5

# CTA + contact
ct_y=py+6
pdf.dark_band(12,ct_y,186,52)
pdf.logo_block(20,ct_y+6,16)
pdf.set_font("Helvetica","B",14); pdf.set_text_color(*WHITE)
pdf.set_xy(40,ct_y+8); pdf.cell(0,7,"Ready to Deploy Your First AI Voice Agent?")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(148,163,184)
pdf.set_xy(40,ct_y+17)
pdf.multi_cell(148,4.5,
    "Sign up in under 2 minutes. Get $5 free credits. Your first agent live in under 10 minutes.")

pdf.fr(20,ct_y+33,52,12,*BRAND)
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*WHITE)
pdf.set_xy(20,ct_y+34); pdf.cell(52,10,"Start Free Trial",align="C")
pdf.fr(78,ct_y+33,52,12,40,40,70)
pdf.set_draw_color(80,80,120); pdf.rect(78,ct_y+33,52,12,"D")
pdf.set_font("Helvetica","B",9); pdf.set_text_color(203,213,225)
pdf.set_xy(78,ct_y+34); pdf.cell(52,10,"Book a Demo",align="C")

contacts=[("Platform","snapserve.ai"),("Support","support@snapserve.ai"),
          ("Sales","sales@snapserve.ai"),("Docs","docs.snapserve.ai")]
cx_ct=136
for lbl,val in contacts:
    pdf.set_font("Helvetica","B",6.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(cx_ct,ct_y+9); pdf.cell(0,5,lbl.upper())
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(203,213,225)
    pdf.set_xy(cx_ct,ct_y+15); pdf.cell(0,5,val)
    cx_ct+=32 if lbl in("Platform","Support") else 30

pdf.footer_bar()

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
pdf.output(OUTPUT)
print(f"Brochure saved -> {OUTPUT}")
