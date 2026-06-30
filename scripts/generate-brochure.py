from fpdf import FPDF
from fpdf.enums import XPos, YPos
import os

OUTPUT = "artifacts/snapserve-book/public/brochure/snapserve-brochure.pdf"

# Brand palette
BRAND  = (108, 99, 255)   # purple
ACCENT = ( 16,185,129)    # green
DARK   = ( 15, 15, 26)    # near-black background
DARK2  = ( 28, 28, 50)    # card dark bg
WHITE  = (255,255,255)
LBG    = (248,250,252)    # light card bg
BORDER = (226,232,240)    # card border
TEXT   = ( 15, 23, 42)
MUTED  = (100,116,139)
ORANGE = (245,158, 11)
RED    = (239, 68, 68)
GOLD   = (251,191, 36)


class B(FPDF):
    def header(self): pass
    def footer(self): pass

    # — drawing helpers ———————————————————————————————————————————————————————
    def fr(self, x, y, w, h, r, g, b):
        self.set_fill_color(r,g,b); self.set_draw_color(r,g,b)
        self.rect(x,y,w,h,"F")

    def frd(self, x, y, w, h, fr,fg,fb, br,bg2,bb):
        self.set_fill_color(fr,fg,fb); self.set_draw_color(br,bg2,bb)
        self.rect(x,y,w,h,"FD")

    def logo_mark(self, x, y, size=18):
        """Draw the SnapServe logo mark: purple square + white S."""
        self.fr(x, y, size, size, *BRAND)
        self.set_font("Helvetica","B", int(size * 0.56))
        self.set_text_color(*WHITE)
        self.set_xy(x, y)
        self.cell(size, size, "S", align="C")

    def logo_full(self, x, y, size=18, dark=True):
        """Logo mark + SnapServe wordmark."""
        self.logo_mark(x, y, size)
        tc = WHITE if dark else TEXT
        self.set_font("Helvetica","B", int(size * 0.78))
        self.set_text_color(*tc)
        self.set_xy(x + size + 4, y + size*0.1)
        self.cell(0, size * 0.5, "SnapServe")
        self.set_font("Helvetica","", int(size * 0.38))
        self.set_text_color(*MUTED)
        self.set_xy(x + size + 4, y + size * 0.55)
        self.cell(0, size * 0.45, "AI VOICE PLATFORM")

    def hdr(self, page_num, total=7):
        self.fr(0,0,210,14,*DARK)
        self.logo_mark(7, 1.8, 10)
        self.set_font("Helvetica","B",8.5); self.set_text_color(*WHITE)
        self.set_xy(20,3.5); self.cell(0,7,"SnapServe  -  AI Voice Platform",new_x=XPos.LMARGIN)
        self.set_font("Helvetica","",8); self.set_text_color(*MUTED)
        self.set_xy(20,3.5); self.cell(178,7,f"Page {page_num} of {total}",align="R")

    def ftr(self):
        self.set_draw_color(*BORDER); self.line(10,282,200,282)
        self.set_font("Helvetica","",7.5); self.set_text_color(*MUTED)
        self.set_xy(10,283); self.cell(0,5,"(c) 2026 SnapServe.  All rights reserved.  Confidential.",new_x=XPos.LMARGIN)
        self.set_xy(10,283); self.cell(190,5,"snapserve.ai",align="R")

    def eyebrow(self,x,y,text):
        self.set_font("Helvetica","B",7.5); self.set_text_color(*BRAND)
        self.set_xy(x,y); self.cell(0,5,text.upper())

    def section_title(self,x,y,text,size=17):
        self.set_font("Helvetica","B",size); self.set_text_color(*TEXT)
        self.set_xy(x,y); self.cell(0,8,text)

    def body_text(self,x,y,w,text,size=9):
        self.set_font("Helvetica","",size); self.set_text_color(*MUTED)
        self.set_xy(x,y); self.multi_cell(w,5,text)

    def feat_card(self,x,y,w,h,tag,title,desc,accent=False):
        bg = (240,244,255) if accent else LBG
        bc = (199,210,254) if accent else BORDER
        self.frd(x,y,w,h,*bg,*bc)
        badge_bg = (199,210,254) if accent else (226,232,240)
        self.fr(x+5,y+5,14,11,*badge_bg)
        self.set_font("Helvetica","B",6.5)
        self.set_text_color(*BRAND if accent else TEXT)
        self.set_xy(x+5,y+6); self.cell(14,9,tag,align="C")
        self.set_font("Helvetica","B",8.5); self.set_text_color(*TEXT)
        self.set_xy(x+5,y+19); self.cell(w-10,5,title)
        self.set_font("Helvetica","",7.5); self.set_text_color(*MUTED)
        self.set_xy(x+5,y+26); self.multi_cell(w-10,4.2,desc)


pdf = B(orientation="P",unit="mm",format="A4")
pdf.set_auto_page_break(False)
pdf.set_margins(0,0,0)


# ════════════════════════════════════════════════════════════════════════════
# PAGE 1 — COVER
# ════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.fr(0,0,210,297,*DARK)        # full dark background
pdf.fr(0,0,210,5,*BRAND)         # top accent stripe

# — logo + wordmark at top-left
pdf.logo_full(12, 14, 22, dark=True)

# — Product Brochure badge top-right
pdf.fr(150,14,50,12,30,28,70)
pdf.set_font("Helvetica","B",8); pdf.set_text_color(165,180,252)
pdf.set_xy(150,14); pdf.cell(50,12,"Product Brochure  2026",align="C")

# — eyebrow
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*ACCENT)
pdf.set_xy(10,88); pdf.cell(190,6,"ENTERPRISE AI VOICE AGENTS",align="C")

# — hero headline
pdf.set_font("Helvetica","B",42); pdf.set_text_color(*WHITE)
pdf.set_xy(10,96); pdf.cell(190,18,"Your Business,",align="C")
pdf.set_text_color(*BRAND)
pdf.set_xy(10,114); pdf.cell(190,18,"Speaking Smarter.",align="C")

# — tagline
pdf.set_font("Helvetica","",11.5); pdf.set_text_color(148,163,184)
pdf.set_xy(28,137)
pdf.multi_cell(154,6,
    "SnapServe is an AI voice agent orchestration platform that lets you deploy\n"
    "intelligent, multilingual voice agents in minutes - no engineering team required.")

# — feature pills
pills=["Auto-Dial Campaigns","Outbound + Caller Memory","Custom SnapServe Voices",
       "Multilingual STT","Any Telephony","Smart Scheduling"]
px=12; py_pill=160
for p in pills:
    pdf.set_font("Helvetica","B",7)
    tw=pdf.get_string_width(p)+12
    if px+tw>200: px=12; py_pill+=11
    pdf.fr(px,py_pill,tw,9,38,36,68)
    pdf.set_text_color(203,213,225)
    pdf.set_xy(px,py_pill+0.5); pdf.cell(tw,8,p,align="C")
    px+=tw+5

# — stats strip
stats=[("$0.05 / min","Fully Managed Plan"),
       ("Auto-Dial","Outbound Campaigns"),
       ("10+","AI Providers Supported"),
       ("4+","Telephony Providers")]
bx=10; sw=46
for val,lbl in stats:
    pdf.fr(bx,182,sw,32,22,22,42)
    pdf.set_font("Helvetica","B",13); pdf.set_text_color(*WHITE)
    pdf.set_xy(bx,188); pdf.cell(sw,7,val,align="C")
    pdf.set_font("Helvetica","",6.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(bx,196); pdf.cell(sw,5,lbl,align="C")
    bx+=sw+3

# — exclusive banner
pdf.fr(12,224,186,22,20,18,52)
pdf.set_draw_color(*GOLD); pdf.rect(12,224,186,22,"D")
pdf.fr(12,224,4,22,*GOLD)        # gold left bar
pdf.set_font("Helvetica","B",9.5); pdf.set_text_color(*GOLD)
pdf.set_xy(22,228); pdf.cell(0,5,"EXCLUSIVE:  SnapServe Custom Voices")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(203,213,225)
pdf.set_xy(22,235)
pdf.cell(0,5,"Proprietary AI voices trained for Indian accents - not available on any other platform.")

# — bottom rule + URL
pdf.set_draw_color(38,36,66); pdf.line(12,260,198,260)
pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
pdf.set_xy(12,262); pdf.cell(0,5,"Confidential - For Client Use Only - 2026")
pdf.set_text_color(*BRAND); pdf.set_xy(12,262); pdf.cell(186,5,"snapserve.ai",align="R")


# ════════════════════════════════════════════════════════════════════════════
# PAGE 2 — CORE PLATFORM FEATURES (12 cards)
# ════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.hdr(2)
pdf.eyebrow(12,19,"Platform Features")
pdf.section_title(12,26,"What SnapServe Delivers")
pdf.body_text(12,37,186,
    "Every feature listed below is built-in - not a third-party add-on. From the first dial tone to the "
    "post-call memory update, SnapServe handles the entire voice stack.")

cards=[
    ("AUTO","Auto-Dial Campaigns",
     "Upload a lead list, set concurrency and go. SnapServe dials automatically, handles busy/no-answer, retries and tracks every outcome.",True),
    ("MEM","Outbound + Caller Memory",
     "Every outbound call is memory-aware. The agent remembers past conversations and picks up exactly where it left off on every retry.",False),
    ("VOICE","SnapServe Custom Voices",
     "Proprietary AI voices trained for Indian English and Indic languages - richer and more natural than any generic TTS. Exclusive to SnapServe.",True),
    ("AMD","Voicemail / AMD Detection",
     "Automatically detects answering machines before connecting the agent, saving minutes and improving true-answer-rate accuracy.",False),
    ("XFER","Warm Transfer",
     "Agent hands off to a human with a live spoken briefing so the operator hears full context before the caller is connected.",False),
    ("BARGE","Barge-In Detection",
     "Callers can interrupt the agent mid-sentence naturally. No awkward pauses, no waiting for the agent to finish its sentence.",False),
    ("GEND","Gender Salutation",
     "Detects caller gender in real time and auto-adjusts the Sir/Ma'am salutation from the very first greeting of the call.",False),
    ("KB","Knowledge Base",
     "Attach product manuals, FAQs, scripts or policies. The agent answers questions from your own content at call time.",False),
    ("SCHED","Smart Scheduling",
     "Built-in booking engine with Google Calendar sync, availability windows, slot locking and automatic email notifications.",False),
    ("CAMP","Campaign Dashboard",
     "Batches, concurrency control, pacing, retry logic, lead status tracking and live call-by-call reporting in one screen.",False),
    ("CRM","CRM & Webhooks",
     "Push call events, transcripts and outcomes to HubSpot, Zoho, Salesforce or any webhook endpoint after every call.",False),
    ("WEB","Web Call Widget",
     "Embed a browser-based call button on your website. Visitors talk to your AI agent - zero telephony setup for the end user.",False),
]
col_w=91; row_h=46; mx=12; my=52
for i,(tag,title,desc,acc) in enumerate(cards):
    col=i%2; row=i//2
    cx=mx+col*(col_w+4); cy=my+row*(row_h+4)
    pdf.feat_card(cx,cy,col_w,row_h,tag,title,desc,acc)

pdf.ftr()


# ════════════════════════════════════════════════════════════════════════════
# PAGE 3 — SNAPSERVE CUSTOM VOICES  (exclusive page)
# ════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.hdr(3)
pdf.eyebrow(12,19,"Exclusive Feature")

# gold headline
pdf.fr(12,27,186,13,26,22,10)
pdf.set_draw_color(*GOLD); pdf.rect(12,27,186,13,"D")
pdf.set_font("Helvetica","B",12); pdf.set_text_color(*GOLD)
pdf.set_xy(12,28); pdf.cell(186,11,"SnapServe Custom Voices - Not Available on Any Other Platform",align="C")

pdf.body_text(12,46,186,
    "While other platforms route calls through generic ElevenLabs or OpenAI voices shared by thousands of businesses, "
    "SnapServe offers a library of proprietary AI voices trained specifically for Indian English and Indic language callers. "
    "These voices are exclusive to the SnapServe platform and cannot be accessed anywhere else.",9)

voice_feats=[
    ("Indian English Accent",
     "Trained on native Indian English speech. Not a generic American or British voice that sounds mismatched to Indian callers."),
    ("Indic Language Voices",
     "Dedicated voices for Hindi, Tamil, Telugu, Malayalam and more - correct prosody, pronunciation and regional nuance built in."),
    ("Custom Brand Voice",
     "Commission a voice trained on your brand persona. Your AI agent sounds exactly how your brand wants - no one else has that voice."),
    ("< 300 ms First Audio",
     "SnapServe voices stream the first audio chunk in under 300 ms - faster than any third-party TTS integration."),
    ("Emotion-Aware Tone",
     "Adapts tone and pace to conversation context: warmer for greetings, clearer for confirmations, calm for objection handling."),
    ("No Provider Lock-In Risk",
     "SnapServe owns these voices, so there is no risk of a third-party provider changing pricing, deprecating a voice or going offline."),
]
vx,vy,vw,vh=12,80,90,40
for i,(vt,vd) in enumerate(voice_feats):
    col=i%2; row=i//2
    cx=vx+col*(vw+4); cy=vy+row*(vh+5)
    pdf.fr(cx,cy,vw,vh,20,18,52)
    pdf.set_draw_color(*BRAND); pdf.rect(cx,cy,vw,vh,"D")
    pdf.fr(cx,cy,3,vh,*GOLD)
    pdf.set_font("Helvetica","B",8.5); pdf.set_text_color(*WHITE)
    pdf.set_xy(cx+7,cy+5); pdf.cell(vw-12,5,vt)
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(148,163,184)
    pdf.set_xy(cx+7,cy+13); pdf.multi_cell(vw-12,4.2,vd)

# comparison table in dark band
cmp_y=vy+3*(vh+5)+4
pdf.fr(12,cmp_y,186,70,*DARK)
pdf.set_font("Helvetica","B",10.5); pdf.set_text_color(*WHITE)
pdf.set_xy(20,cmp_y+6); pdf.cell(0,6,"How SnapServe Voices Compare")

col_hdr=["",   "SnapServe","ElevenLabs","OpenAI TTS","Azure Neural"]
col_wv= [54,    35,          35,           30,          26]
rows_v=[
    ("Indian accent quality",  "Excellent","Generic","Generic","Basic"),
    ("Indic language prosody", "Native",   "Limited","Limited","Limited"),
    ("Custom brand voice",     "Yes",      "Paid extra","No",  "No"),
    ("Exclusive to you",       "Yes",      "No",     "No",     "No"),
    ("First chunk latency",    "< 300 ms", "400-600ms","300-500ms","400ms+"),
]
thy=cmp_y+15; thx=20
for hi,(hdr,hw) in enumerate(zip(col_hdr,col_wv)):
    bg=BRAND if hi==1 else (30,28,60)
    tc=WHITE if hi>=1 else MUTED
    pdf.set_fill_color(*bg); pdf.set_draw_color(40,40,72)
    pdf.rect(thx,thy,hw,7,"FD")
    pdf.set_font("Helvetica","B",6.5); pdf.set_text_color(*tc)
    pdf.set_xy(thx+1,thy+1); pdf.cell(hw-2,5,hdr,align="C" if hi>0 else "L")
    thx+=hw
thy+=7
for ri,row in enumerate(rows_v):
    thx=20
    bg=(22,20,50) if ri%2==0 else (18,16,42)
    for ci,(cell,cw) in enumerate(zip(row,col_wv)):
        cbg=(25,22,60) if ci==1 else bg
        pdf.set_fill_color(*cbg); pdf.set_draw_color(40,40,72)
        pdf.rect(thx,thy,cw,7,"FD")
        if ci==1: tc=BRAND
        elif cell in("Excellent","Native","Yes","< 300 ms"): tc=ACCENT
        elif cell in("Generic","Limited","No","Paid extra"): tc=RED
        else: tc=(180,180,200)
        pdf.set_font("Helvetica","B" if ci<=1 else "",7)
        pdf.set_text_color(*tc)
        pdf.set_xy(thx+1,thy+1); pdf.cell(cw-2,5,cell,align="C" if ci>0 else "L")
        thx+=cw
    thy+=7

pdf.ftr()


# ════════════════════════════════════════════════════════════════════════════
# PAGE 4 — HOW IT WORKS
# ════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.hdr(4)
pdf.eyebrow(12,19,"Architecture")
pdf.section_title(12,26,"How It Works")
pdf.body_text(12,37,186,
    "Every call flows through SnapServe's real-time orchestration pipeline - "
    "from the first ring to the post-call memory update.",9)

# pipeline diagram
pdf.fr(12,50,186,72,*DARK)
nodes=[
    ("Caller",""),("Telephony","Twilio\nPlivo\nVoBiz"),
    ("SnapServe","\nCore"),("ASR","Speech\nto Text"),
    ("LLM","AI\nBrain"),("TTS","Text\nto Voice"),("Caller",""),
]
nw=24; gap=3; nx=14
for j,(nd,sub) in enumerate(nodes):
    is_core=nd=="SnapServe"
    bc=BRAND if is_core else (42,42,72)
    pdf.fr(nx,54,nw,22,*bc)
    if is_core:
        pdf.set_draw_color(*BRAND); pdf.rect(nx,54,nw,22,"D")
    pdf.set_font("Helvetica","B" if is_core else "",7)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(nx,57); pdf.cell(nw,5,nd,align="C")
    for li,ln in enumerate(sub.strip().split("\n")):
        pdf.set_font("Helvetica","",5.5); pdf.set_text_color(148,163,184)
        pdf.set_xy(nx,63+li*4); pdf.cell(nw,4,ln,align="C")
    if j<len(nodes)-1:
        pdf.set_font("Helvetica","B",9); pdf.set_text_color(*BRAND)
        pdf.set_xy(nx+nw,56); pdf.cell(gap,8,">",align="C")
    nx+=nw+gap

prov_rows=[
    ("STT: ",["Deepgram","Azure","Whisper","Sarvam"]),
    ("LLM: ",["OpenAI","Anthropic","DeepSeek","Mistral","Cohere"]),
    ("TTS: ",["SnapServe Custom","ElevenLabs","OpenAI TTS","AWS Polly","Cartesia"]),
    ("TEL: ",["Twilio","Plivo","VoBiz","Vonage"]),
]
pry=80
for pr_lbl,chips in prov_rows:
    pdf.set_font("Helvetica","B",6); pdf.set_text_color(*BRAND)
    pdf.set_xy(14,pry); pdf.cell(10,5,pr_lbl)
    cx_p=27
    for chip in chips:
        is_snap="SnapServe" in chip
        bg=BRAND if is_snap else (35,35,62)
        tc=WHITE if is_snap else (148,163,184)
        pdf.set_font("Helvetica","B" if is_snap else "",5.5)
        tw=pdf.get_string_width(chip)+6
        pdf.fr(cx_p,pry+0.5,tw,5,*bg)
        pdf.set_text_color(*tc)
        pdf.set_xy(cx_p,pry+0.5); pdf.cell(tw,5,chip,align="C")
        cx_p+=tw+3
    pry+=7

steps=[
    ("1","Call Arrives",
     "Your telephony provider (Twilio / Plivo / VoBiz) receives the inbound call or triggers an outbound dial. The live audio stream is routed to SnapServe."),
    ("2","AMD Check",
     "SnapServe's Answering Machine Detection identifies voicemails and machines before connecting the agent, so you only pay for real conversations."),
    ("3","Greeting + Gender Detection",
     "The agent plays its greeting. Simultaneously, SnapServe analyses the caller's first words to detect gender and auto-personalise the Sir/Ma'am salutation."),
    ("4","STT + Caller Memory Lookup",
     "Caller speech is transcribed in real time. SnapServe retrieves the caller's history, facts and prior conversation context from Caller Memory."),
    ("5","LLM Decision",
     "Transcript, memory, system prompt and tools are sent to the LLM. The AI decides what to say, what to look up, whether to book a slot or transfer to a human."),
    ("6","TTS Response",
     "The reply is streamed to SnapServe's custom TTS engine. First audio reaches the caller in under 300 ms. Barge-in detection stays active throughout."),
    ("7","Post-Call Memory Update",
     "After the call, SnapServe summarises the conversation, updates caller facts, logs the outcome and fires configured webhooks and CRM integrations."),
]
sy=128
for sn,st,sd in steps:
    pdf.set_fill_color(*BRAND); pdf.set_draw_color(*BRAND)
    pdf.ellipse(12,sy,8,8,"F")
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*WHITE)
    pdf.set_xy(12,sy+1); pdf.cell(8,6,"sn",align="C")
    pdf.set_xy(12,sy+0.8); pdf.cell(8,6.5,sn,align="C")
    if sn!="7":
        pdf.set_draw_color(*BRAND); pdf.line(16,sy+8,16,sy+19)
    pdf.set_font("Helvetica","B",9); pdf.set_text_color(*TEXT)
    pdf.set_xy(26,sy+0.2); pdf.cell(0,5,st)
    pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
    pdf.set_xy(26,sy+6); pdf.multi_cell(170,4,sd)
    sy+=21

pdf.ftr()


# ════════════════════════════════════════════════════════════════════════════
# PAGE 5 — USE CASES
# ════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.hdr(5)
pdf.eyebrow(12,19,"Applications")
pdf.section_title(12,26,"Who Uses SnapServe?")
pdf.body_text(12,37,186,
    "From BFSI collections to EdTech admissions, SnapServe powers voice agents "
    "across every industry that calls customers at scale.",9)

use_cases=[
    ("BFSI","Banking & Finance","Loan follow-up, EMI reminders, KYC collection, balance enquiry, payment confirmations."),
    ("HLTH","Healthcare","Appointment booking, prescription reminders, lab result notifications, patient follow-ups."),
    ("ECOM","E-Commerce","Order status, delivery confirmations, COD verification, return initiations, satisfaction calls."),
    ("REAL","Real Estate","Lead qualification, site visit scheduling, NRI investor outreach, follow-up automation."),
    ("TELCO","Telecom","Outage notifications, bill reminders, plan upgrades, service renewal, complaint triage."),
    ("EDTCH","EdTech","Admission follow-up, class reminders, parent communication, fee collection."),
    ("AUTO","Automotive","Test drive scheduling, service reminders, insurance renewal, post-service NPS calls."),
    ("INSUR","Insurance","Policy renewals, claim status updates, premium collection, outbound servicing."),
    ("COLL","Collections/Sales","Predictive dialing, lead scoring by outcome, warm transfer to human closers."),
]
cxu,cyu,cwu,chu=12,54,58,44
for i,(ico,title,desc) in enumerate(use_cases):
    col=i%3; row=i//3
    cx=cxu+col*(cwu+4); cy=cyu+row*(chu+4)
    pdf.frd(cx,cy,cwu,chu,*LBG,*BORDER)
    pdf.fr(cx+cwu/2-7,cy+4,14,11,*BORDER)
    pdf.set_font("Helvetica","B",6); pdf.set_text_color(*BRAND)
    pdf.set_xy(cx+cwu/2-7,cy+5.3); pdf.cell(14,8,ico,align="C")
    pdf.set_font("Helvetica","B",8); pdf.set_text_color(*TEXT)
    pdf.set_xy(cx+4,cy+17); pdf.cell(cwu-8,5,title,align="C")
    pdf.set_font("Helvetica","",7); pdf.set_text_color(*MUTED)
    pdf.set_xy(cx+3,cy+23); pdf.multi_cell(cwu-6,3.8,desc)

mby=cyu+3*(chu+4)+4
pdf.fr(12,mby,186,46,*DARK)
pdf.set_font("Helvetica","B",11); pdf.set_text_color(*WHITE)
pdf.set_xy(20,mby+6); pdf.cell(0,6,"Built for Multilingual India")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(148,163,184)
pdf.set_xy(20,mby+14)
pdf.multi_cell(170,4.8,
    "SnapServe agents speak and understand Hindi, Tamil, Telugu, Malayalam, Kannada, Marathi, "
    "Bengali and Indian English - switching languages mid-call based on caller preference. "
    "SnapServe Custom Voices are trained on native Indian speech, giving your agents an accent "
    "your customers trust.")
langs=["Hindi","Tamil","Telugu","Malayalam","Kannada","Marathi","Bengali","English"]
lx=20
for lang in langs:
    pdf.set_font("Helvetica","B",7)
    tw=pdf.get_string_width(lang)+10
    pdf.fr(lx,mby+36,tw,7,38,36,68)
    pdf.set_text_color(203,213,225)
    pdf.set_xy(lx,mby+36.5); pdf.cell(tw,6,lang,align="C")
    lx+=tw+4

pdf.ftr()


# ════════════════════════════════════════════════════════════════════════════
# PAGE 6 — PRICING
# ════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.hdr(6)
pdf.eyebrow(12,19,"Pricing")
pdf.section_title(12,26,"Simple, Transparent Pricing")
pdf.body_text(12,37,186,"Two plans. No hidden fees. No per-seat charges. Pay only for what your agents use.",9)

# Managed plan card
pdf.frd(12,50,88,118,*LBG,*BORDER)
pdf.set_font("Helvetica","B",8.5); pdf.set_text_color(*BRAND)
pdf.set_xy(20,57); pdf.cell(0,5,"MANAGED PLAN")
pdf.set_font("Helvetica","B",30); pdf.set_text_color(*TEXT)
pdf.set_xy(20,64); pdf.cell(0,13,"$0.05")
pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
pdf.set_xy(20,79); pdf.cell(0,5,"per minute - all-inclusive")
pdf.set_font("Helvetica","",8); pdf.set_text_color(55,65,81)
pdf.set_xy(20,87); pdf.multi_cell(72,4.5,
    "We supply all AI keys (ASR, LLM, TTS). Just configure your agents and go live. Zero friction.")
feats_m=["All AI providers included","No API keys to manage",
         "SnapServe Custom Voices","Auto-Dial campaigns",
         "Caller memory across calls","Smart scheduling","CRM webhooks",
         "$5 free credits on sign-up"]
fy=110
for f in feats_m:
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*ACCENT)
    pdf.set_xy(20,fy); pdf.cell(5,5,"v")
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(*TEXT)
    pdf.set_xy(26,fy); pdf.cell(0,5,f); fy+=6.5

# BYOP card
pdf.fr(108,50,92,118,*DARK2)
pdf.set_draw_color(*BRAND); pdf.rect(108,50,92,118,"D")
pdf.fr(136,50,64,9,*ACCENT)
pdf.set_font("Helvetica","B",6.5); pdf.set_text_color(*WHITE)
pdf.set_xy(136,51); pdf.cell(64,7,"BEST VALUE - MOST POPULAR",align="C")
pdf.set_font("Helvetica","B",8.5); pdf.set_text_color(*ACCENT)
pdf.set_xy(116,63); pdf.cell(0,5,"BYOP PLAN")
pdf.set_font("Helvetica","B",30); pdf.set_text_color(*WHITE)
pdf.set_xy(116,70); pdf.cell(0,13,"$0.035")
pdf.set_font("Helvetica","",8); pdf.set_text_color(*MUTED)
pdf.set_xy(116,85); pdf.cell(0,5,"per minute - orchestration only")
pdf.set_font("Helvetica","",8); pdf.set_text_color(148,163,184)
pdf.set_xy(116,93); pdf.multi_cell(76,4.5,
    "Bring your own API keys. Pay SnapServe only for orchestration. Best for high-volume.")
feats_b=["Use your own ASR/LLM/TTS keys","Lower per-minute cost",
         "SnapServe Custom Voices available","Auto-Dial campaigns",
         "Caller memory across calls","Smart scheduling","CRM webhooks",
         "Ideal for 1000+ min/day"]
fy=116
for f in feats_b:
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*ACCENT)
    pdf.set_xy(116,fy); pdf.cell(5,5,"v")
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(203,213,225)
    pdf.set_xy(122,fy); pdf.cell(0,5,f); fy+=6.5

# Guidance box
pdf.frd(12,176,186,42,*LBG,*BORDER)
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*TEXT)
pdf.set_xy(20,182); pdf.cell(0,5,"Which plan is right for you?")
pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*BRAND)
pdf.set_xy(20,190); pdf.cell(0,5,"Choose Managed if...")
pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*ACCENT)
pdf.set_xy(112,190); pdf.cell(0,5,"Choose BYOP if...")
for ti,tip in enumerate(["Just getting started","No API keys to manage",
                          "Low-medium call volume","Fastest go-live"]):
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(20,197+ti*5); pdf.cell(0,5,"- "+tip)
for ti,tip in enumerate(["1000+ min/day volume","Existing provider contracts",
                          "Cost optimisation priority","Specific provider features"]):
    pdf.set_font("Helvetica","",7.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(112,197+ti*5); pdf.cell(0,5,"- "+tip)

# Free trial bar
pdf.frd(12,225,186,19,240,253,244,167,243,208)
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*ACCENT)
pdf.set_xy(20,231); pdf.cell(0,5,"Free Trial:  $5 of call credits (~100 minutes) on every new account.  No credit card required.")
pdf.set_font("Helvetica","",8); pdf.set_text_color(55,65,81)
pdf.set_xy(20,237); pdf.cell(0,5,"Top up your wallet at any time.  Cancel or change plans whenever you like.")

pdf.ftr()


# ════════════════════════════════════════════════════════════════════════════
# PAGE 7 — PROVIDERS, COMPARISON & CONTACT
# ════════════════════════════════════════════════════════════════════════════
pdf.add_page()
pdf.hdr(7)
pdf.eyebrow(12,19,"Integrations & Comparison")
pdf.section_title(12,26,"Supported Providers")

prov=[
    ("STT (Speech-to-Text)",[(108,99,255),"Deepgram","Azure Speech","OpenAI Whisper","Sarvam AI"]),
    ("LLM Models",          [(16,185,129),"OpenAI GPT-4o","Anthropic Claude","DeepSeek","Mistral","Cohere","Groq"]),
    ("TTS (Text-to-Speech)",[(245,158,11),"SnapServe Custom","ElevenLabs","OpenAI TTS","AWS Polly","Azure Neural","Cartesia","Deepgram Aura"]),
    ("Telephony",           [(239,68,68), "Twilio","Plivo","VoBiz","Vonage"]),
]
py=40
for sec_t,chips in prov:
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(12,py); pdf.cell(0,5,sec_t.upper())
    py+=6
    dot_c=chips[0]; labels=chips[1:]
    cx_c=12
    for label in labels:
        is_snap="SnapServe" in label
        pdf.set_font("Helvetica","B" if is_snap else "",7.5)
        tw=pdf.get_string_width(label)+13
        if is_snap:
            pdf.fr(cx_c,py,tw,8,*BRAND)
            pdf.set_text_color(*WHITE)
            pdf.set_xy(cx_c+3,py+0.5); pdf.cell(tw-4,7,label)
        else:
            pdf.frd(cx_c,py,tw,8,*LBG,*BORDER)
            pdf.set_fill_color(*dot_c); pdf.set_draw_color(*dot_c)
            pdf.ellipse(cx_c+3.5,py+2.8,2.8,2.8,"F")
            pdf.set_text_color(*TEXT)
            pdf.set_xy(cx_c+8,py+0.5); pdf.cell(tw-10,7,label)
        cx_c+=tw+3
        if cx_c>175: cx_c=12; py+=10
    py+=12

# Comparison table
pdf.eyebrow(12,py,"Comparison"); py+=6
pdf.set_font("Helvetica","B",11); pdf.set_text_color(*TEXT)
pdf.set_xy(12,py); pdf.cell(0,6,"SnapServe vs. Alternatives"); py+=8

cols_w=[60,33,32,30,31]
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
    ("Custom/Indic voices",     "Yes - Own","No",       "No",     "DIY"),
    ("Auto-Dial campaigns",     "Yes - Built-in","Basic","No",     "DIY"),
    ("Caller memory",           "Yes - Built-in","No",   "No",     "DIY"),
    ("AMD detection",           "Yes",      "Limited",  "No",     "DIY"),
    ("Gender salutation",       "Yes",      "No",       "No",     "No"),
    ("Warm transfer",           "Yes",      "Yes",      "No",     "DIY"),
    ("Scheduling / booking",    "Yes - Full","No",      "No",     "DIY"),
    ("Multilingual Indic",      "Yes - Full","Limited", "Yes",    "DIY"),
    ("BYOP provider keys",      "Yes",      "Yes",      "Yes",    "Yes"),
    ("Setup time",              "< 10 min", "< 10 min", "Hours",  "Weeks"),
]
py+=9
for ri,row in enumerate(rows):
    bg=(250,250,255) if ri%2==0 else WHITE
    hx2=12
    for ci,(cell,cw) in enumerate(zip(row,cols_w)):
        cbg=(245,243,255) if ci==1 else bg
        pdf.set_fill_color(*cbg); pdf.set_draw_color(*BORDER)
        pdf.rect(hx2,py,cw,7,"FD")
        if ci==1: tc=BRAND
        elif cell.startswith("Yes"): tc=ACCENT
        elif cell=="No": tc=RED
        else: tc=TEXT
        pdf.set_font("Helvetica","B" if ci<=1 else "",7); pdf.set_text_color(*tc)
        pdf.set_xy(hx2+2,py+1); pdf.cell(cw-4,5,cell,align="C" if ci>0 else "L")
        hx2+=cw
    py+=7

# CTA strip
ct_y=py+4
pdf.fr(12,ct_y,186,54,*DARK)
pdf.logo_mark(20, ct_y+8, 16)
pdf.set_font("Helvetica","B",13); pdf.set_text_color(*WHITE)
pdf.set_xy(40,ct_y+8); pdf.cell(0,7,"Ready to Deploy Your First AI Voice Agent?")
pdf.set_font("Helvetica","",8.5); pdf.set_text_color(148,163,184)
pdf.set_xy(40,ct_y+17)
pdf.multi_cell(148,4.5,"Sign up in 2 minutes. $5 free credits. First agent live in under 10 minutes.")

pdf.fr(20,ct_y+34,50,11,*BRAND)
pdf.set_font("Helvetica","B",9); pdf.set_text_color(*WHITE)
pdf.set_xy(20,ct_y+34); pdf.cell(50,11,"Start Free Trial",align="C")
pdf.fr(76,ct_y+34,50,11,38,36,68)
pdf.set_draw_color(70,68,100); pdf.rect(76,ct_y+34,50,11,"D")
pdf.set_font("Helvetica","B",9); pdf.set_text_color(203,213,225)
pdf.set_xy(76,ct_y+34); pdf.cell(50,11,"Book a Demo",align="C")

contacts=[("Platform","snapserve.ai"),("Support","support@snapserve.ai"),
          ("Sales","sales@snapserve.ai"),("Docs","docs.snapserve.ai")]
cx_ct=140
for lbl,val in contacts:
    pdf.set_font("Helvetica","B",6.5); pdf.set_text_color(*MUTED)
    pdf.set_xy(cx_ct,ct_y+10); pdf.cell(0,5,lbl.upper())
    pdf.set_font("Helvetica","B",7.5); pdf.set_text_color(203,213,225)
    pdf.set_xy(cx_ct,ct_y+17); pdf.cell(0,5,val)
    cx_ct+=28 if lbl in("Platform","Support") else 26

pdf.ftr()

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
pdf.output(OUTPUT)
print(f"Saved -> {OUTPUT}")
